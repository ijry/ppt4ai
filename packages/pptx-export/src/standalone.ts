import { parseBitmapMetadata, validateDocument, type AssetAdapter, type Element, type Ppt4aiDocument, type Theme } from '@ppt4ai/model'
import { allocateMediaPath, allocateRelationshipId, imageExtension, serializeImageRelationship, serializePictureXml } from './image-writeback.js'
import { writeStoredZip, type ZipEntry } from './zip.js'
import {
  serializeAppPropertiesXml,
  serializeContentTypesXml,
  serializeCorePropertiesXml,
  serializeLayoutRelationshipsXml,
  serializeLayoutXml,
  serializeMasterRelationshipsXml,
  serializeMasterXml,
  serializePresentationRelationshipsXml,
  serializePresentationSupportXml,
  serializePresentationXml,
  serializeRootRelationshipsXml,
  serializeShapeXml,
  serializeSlideRelationshipsXml,
  serializeSlideXml,
  serializeTableFrameXml,
  serializeThemeXml,
} from './standalone-xml.js'

export interface CreatePptxOptions {
  assetAdapter?: AssetAdapter
}

interface MaterializedAsset {
  path: string
  bytes: Uint8Array
}

interface SlideSerialization {
  xml: string
  relationships: string
}

function documentValidationError(document: Ppt4aiDocument): Error | undefined {
  const validation = validateDocument(document)
  return validation.valid ? undefined : new Error(`PPTX generation document invalid: ${validation.errors.join('; ')}`)
}

function elementFor(document: Ppt4aiDocument, slideId: string, elementId: string): Element {
  const element = document.elements[elementId]
  if (!element) throw new Error(`PPTX generation element mapping missing for slide ${slideId}`)
  return element
}

function validateElementKinds(document: Ppt4aiDocument): void {
  for (const slideId of document.slideOrder) {
    const slide = document.slides[slideId]
    if (!slide) throw new Error(`PPTX generation slide missing: ${slideId}`)
    for (const elementId of slide.elementIds) {
      const element = elementFor(document, slideId, elementId)
      if (element.kind !== 'shape' && element.kind !== 'text' && element.kind !== 'table' && element.kind !== 'image') {
        throw new Error(`PPTX generation unsupported element kind: ${element.kind}`)
      }
    }
  }
}

/**
 * Every asset a slide element needs: a picture is one, and so is a shape whose fill is one. One
 * function, so materialization and serialization cannot disagree about which elements need media.
 */
function assetReference(element: Element): string | undefined {
  if (element.kind === 'image') return element.assetId
  if (element.kind === 'shape' || element.kind === 'text') return element.pictureFill?.assetId
  return undefined
}

/** A table's cells can each hold a photo, so an element can need more than one asset. */
function tableAssetReferences(element: Element): string[] {
  if (element.kind !== 'table') return []
  return element.rows.flatMap((row) => row.cells.flatMap((cell) => cell.pictureFill ? [cell.pictureFill.assetId] : []))
}

/** A slide's own photo background needs materializing too, and shares media with any element using it. */
function slideAssetReferences(document: Ppt4aiDocument, slideId: string): string[] {
  const slide = document.slides[slideId]
  if (!slide) throw new Error(`PPTX generation slide missing: ${slideId}`)
  const background = slide.background?.pictureFill?.assetId
  return [
    ...(background ? [background] : []),
    ...slide.elementIds.flatMap((elementId) => {
      const element = elementFor(document, slideId, elementId)
      const assetId = assetReference(element)
      return [...(assetId ? [assetId] : []), ...tableAssetReferences(element)]
    }),
  ]
}

async function materializeAssets(document: Ppt4aiDocument, options: CreatePptxOptions): Promise<{ assets: Map<string, MaterializedAsset>; extensions: Set<string> }> {
  const assets = new Map<string, MaterializedAsset>()
  const extensions = new Set<string>()
  const entryNames = new Set<string>()
  for (const slideId of document.slideOrder) {
    const slide = document.slides[slideId]
    if (!slide) throw new Error(`PPTX generation slide missing: ${slideId}`)
    for (const assetId of slideAssetReferences(document, slideId)) {
      if (assets.has(assetId)) continue
      const metadata = document.assets?.[assetId]
      if (!metadata) throw new Error(`PPTX generation asset metadata missing: ${assetId}`)
      if (!options.assetAdapter) throw new Error(`PPTX generation asset adapter missing: ${assetId}`)
      let sourceBytes: Uint8Array | undefined
      try {
        sourceBytes = await options.assetAdapter.get(assetId)
      } catch (cause) {
        throw new Error(`PPTX generation asset read failed: ${assetId}`, { cause })
      }
      if (sourceBytes === undefined) throw new Error(`PPTX generation asset bytes missing: ${assetId}`)
      const bytes = new Uint8Array(sourceBytes)
      const bitmap = parseBitmapMetadata(bytes)
      if (!bitmap || bitmap.mimeType !== metadata.mimeType) throw new Error(`PPTX generation asset bytes MIME mismatch: ${assetId}`)
      let extension: string
      try {
        extension = imageExtension(metadata.mimeType)
      } catch (cause) {
        throw new Error(`PPTX generation asset MIME unsupported: ${assetId}`, { cause })
      }
      const path = allocateMediaPath(entryNames, metadata.mimeType)
      entryNames.add(path)
      extensions.add(extension)
      assets.set(assetId, { path, bytes })
    }
  }
  return { assets, extensions }
}

function serializeSlideElements(document: Ppt4aiDocument, slideId: string, assets: Map<string, MaterializedAsset>): SlideSerialization {
  const slide = document.slides[slideId]
  if (!slide) throw new Error(`PPTX generation slide missing: ${slideId}`)
  let nextShapeId = 2
  const imageRelationships: string[] = []
  const relationshipIds = new Set<string>(['rId1'])
  const relationshipByMediaPath = new Map<string, string>()
  const serializedElements: string[] = []
  // One relationship per media part, so a picture and a shape filled with the same photo share it.
  const relationshipFor = (assetId: string): string => {
    const asset = assets.get(assetId)
    if (!asset) throw new Error(`PPTX generation asset materialization missing: ${assetId}`)
    const existing = relationshipByMediaPath.get(asset.path)
    if (existing) return existing
    const relationshipId = allocateRelationshipId(relationshipIds)
    relationshipIds.add(relationshipId)
    relationshipByMediaPath.set(asset.path, relationshipId)
    imageRelationships.push(serializeImageRelationship(relationshipId, `../media/${asset.path.slice('ppt/media/'.length)}`))
    return relationshipId
  }
  for (const elementId of slide.elementIds) {
    const element = elementFor(document, slideId, elementId)
    if (element.kind === 'shape' || element.kind === 'text') {
      const pictureRelationshipId = element.pictureFill ? relationshipFor(element.pictureFill.assetId) : undefined
      serializedElements.push(serializeShapeXml(element, nextShapeId, pictureRelationshipId))
    } else if (element.kind === 'table') {
      serializedElements.push(serializeTableFrameXml(element, nextShapeId, relationshipFor))
    } else if (element.kind === 'image') {
      serializedElements.push(serializePictureXml(element, relationshipFor(element.assetId), nextShapeId))
    } else {
      throw new Error(`PPTX generation unsupported element kind: ${element.kind}`)
    }
    nextShapeId += 1
  }
  const backgroundAsset = slide.background?.pictureFill?.assetId
  return {
    xml: serializeSlideXml(
      serializedElements,
      slide.background,
      backgroundAsset ? relationshipFor(backgroundAsset) : undefined,
    ),
    relationships: serializeSlideRelationshipsXml(imageRelationships),
  }
}

function effectiveTheme(document: Ppt4aiDocument): Theme | undefined {
  const masterIds = Object.keys(document.masters ?? {}).sort()
  const referenced = masterIds
    .map((id) => document.masters?.[id]?.themeId)
    .map((id) => id ? document.themes?.[id] : undefined)
    .find((theme): theme is Theme => theme !== undefined)
  if (referenced) return referenced
  return Object.keys(document.themes ?? {}).sort()
    .map((id) => document.themes?.[id])
    .find((theme): theme is Theme => theme !== undefined)
}

function skeletonEntries(document: Ppt4aiDocument, slides: SlideSerialization[], materialized: Map<string, MaterializedAsset>, imageExtensions: Set<string>, theme?: Theme): ZipEntry[] {
  const slideCount = document.slideOrder.length
  const support = serializePresentationSupportXml()
  const encoder = new TextEncoder()
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: encoder.encode(serializeContentTypesXml(slideCount, imageExtensions)) },
    { name: '_rels/.rels', data: encoder.encode(serializeRootRelationshipsXml()) },
    { name: 'docProps/core.xml', data: encoder.encode(serializeCorePropertiesXml()) },
    { name: 'docProps/app.xml', data: encoder.encode(serializeAppPropertiesXml()) },
    { name: 'ppt/presentation.xml', data: encoder.encode(serializePresentationXml(document.page, slideCount)) },
    { name: 'ppt/_rels/presentation.xml.rels', data: encoder.encode(serializePresentationRelationshipsXml(slideCount)) },
    { name: 'ppt/presProps.xml', data: encoder.encode(support.presProps) },
    { name: 'ppt/viewProps.xml', data: encoder.encode(support.viewProps) },
    { name: 'ppt/theme/theme1.xml', data: encoder.encode(serializeThemeXml(theme)) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: encoder.encode(serializeMasterXml()) },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: encoder.encode(serializeMasterRelationshipsXml()) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: encoder.encode(serializeLayoutXml()) },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: encoder.encode(serializeLayoutRelationshipsXml()) },
  ]
  for (let index = 0; index < slideCount; index += 1) {
    const slide = slides[index]
    if (!slide) throw new Error(`PPTX generation slide serialization missing: ${index + 1}`)
    entries.push(
      { name: `ppt/slides/slide${index + 1}.xml`, data: encoder.encode(slide.xml) },
      { name: `ppt/slides/_rels/slide${index + 1}.xml.rels`, data: encoder.encode(slide.relationships) },
    )
  }
  for (const asset of materialized.values()) entries.push({ name: asset.path, data: asset.bytes })
  return entries
}

export async function createPptx(document: Ppt4aiDocument, options: CreatePptxOptions = {}): Promise<Uint8Array> {
  const error = documentValidationError(document)
  if (error) throw error
  validateElementKinds(document)
  const materialized = await materializeAssets(document, options)
  const slides = document.slideOrder.map((slideId) => serializeSlideElements(document, slideId, materialized.assets))
  return writeStoredZip(skeletonEntries(document, slides, materialized.assets, materialized.extensions, effectiveTheme(document)))
}

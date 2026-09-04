import { parseBitmapMetadata, validateDocument, type AssetAdapter, type Element, type Ppt4aiDocument, type Theme } from '@ppt4ai/model'
import { allocateMediaPath, allocateRelationshipId, imageExtension, serializeImageRelationship, serializePictureXml } from './image-writeback.js'
import { writeStoredZip, type ZipEntry } from './zip.js'
import {
  serializeAppPropertiesXml,
  serializeContentTypesXml,
  serializeCorePropertiesXml,
  serializeGroupXml,
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

interface SlideTreeNode {
  element: Element
  children: SlideTreeNode[]
}

/**
 * The slide's elements as a tree, in the order `documentToSceneGraph` paints them: `elementIds` order,
 * groups expanded where they sit, and an element already emitted inside a group not emitted twice.
 *
 * The rule is copied from the renderer rather than invented, because the two producers of groups
 * disagree about the flat list: the importer leaves children in `elementIds` (group first), while the
 * editor's group command takes them out. The renderer's `visited` set is what tolerates both, so
 * sharing it keeps the file's draw order identical to the canvas — including the corner where a child
 * precedes its own group and therefore paints as a top-level element.
 */
function slideTree(document: Ppt4aiDocument, slideId: string): SlideTreeNode[] {
  const slide = document.slides[slideId]
  if (!slide) throw new Error(`PPTX generation slide missing: ${slideId}`)
  const visited = new Set<string>()
  const build = (elementId: string): SlideTreeNode[] => {
    if (visited.has(elementId)) return []
    visited.add(elementId)
    const element = elementFor(document, slideId, elementId)
    if (element.kind !== 'group') return [{ element, children: [] }]
    return [{ element, children: element.childIds.flatMap(build) }]
  }
  return slide.elementIds.flatMap(build)
}

/**
 * The kind of an element the union says cannot exist. A document is JSON, so a fifth kind the model
 * has no serializer for can still arrive at runtime, and it has to name itself in the error.
 */
function unmodeledKind(element: never): string {
  return String((element as { kind?: unknown }).kind)
}

function validateElementKinds(document: Ppt4aiDocument): void {
  const validate = (nodes: readonly SlideTreeNode[]): void => {
    for (const node of nodes) {
      const element = node.element
      if (element.kind === 'group') {
        validate(node.children)
        continue
      }
      if (element.kind !== 'shape' && element.kind !== 'text' && element.kind !== 'table' && element.kind !== 'image') {
        throw new Error(`PPTX generation unsupported element kind: ${unmodeledKind(element)}`)
      }
    }
  }
  for (const slideId of document.slideOrder) validate(slideTree(document, slideId))
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

/**
 * A slide's own photo background needs materializing too, and shares media with any element using it.
 * The element walk is the same tree serialization writes, so a photo nested in a group cannot be
 * missed here and then demanded there.
 */
function slideAssetReferences(document: Ppt4aiDocument, slideId: string): string[] {
  const slide = document.slides[slideId]
  if (!slide) throw new Error(`PPTX generation slide missing: ${slideId}`)
  const background = slide.background?.pictureFill?.assetId
  const walk = (nodes: readonly SlideTreeNode[]): string[] => nodes.flatMap((node) => {
    const assetId = assetReference(node.element)
    return [...(assetId ? [assetId] : []), ...tableAssetReferences(node.element), ...walk(node.children)]
  })
  return [...(background ? [background] : []), ...walk(slideTree(document, slideId))]
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
  // One shape id cursor for the whole tree: `p:cNvPr/@id` is unique per slide, and a group's own id is
  // allocated before its children so the numbers ascend in document order.
  const serializeNode = (node: SlideTreeNode): string => {
    const shapeId = nextShapeId
    nextShapeId += 1
    const element = node.element
    if (element.kind === 'group') return serializeGroupXml(element, shapeId, node.children.map(serializeNode))
    if (element.kind === 'shape' || element.kind === 'text') {
      const pictureRelationshipId = element.pictureFill ? relationshipFor(element.pictureFill.assetId) : undefined
      return serializeShapeXml(element, shapeId, pictureRelationshipId)
    }
    if (element.kind === 'table') return serializeTableFrameXml(element, shapeId, relationshipFor)
    if (element.kind === 'image') return serializePictureXml(element, relationshipFor(element.assetId), shapeId)
    throw new Error(`PPTX generation unsupported element kind: ${unmodeledKind(element)}`)
  }
  const serializedElements = slideTree(document, slideId).map(serializeNode)
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

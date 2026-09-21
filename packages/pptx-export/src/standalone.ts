import { mergeColorMaps, parseBitmapMetadata, validateDocument, type AssetAdapter, type ColorMap, type Element, type Ppt4aiDocument, type SlideBackground, type SlideLayout, type SlideMaster, type Theme } from '@ppt4ai/model'
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
  serializeTableStylesXml,
  serializeThemeXml,
  type PackageParts,
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

/** Master and layout picture backgrounds, sorted by id so the media parts are named deterministically. */
function inheritedAssetReferences(document: Ppt4aiDocument): string[] {
  const backgrounds = [
    ...Object.keys(document.masters ?? {}).sort().map((id) => document.masters?.[id]?.background),
    ...Object.keys(document.layouts ?? {}).sort().map((id) => document.layouts?.[id]?.background),
  ]
  return backgrounds.flatMap((background) => background?.pictureFill ? [background.pictureFill.assetId] : [])
}

async function materializeAssets(document: Ppt4aiDocument, options: CreatePptxOptions): Promise<{ assets: Map<string, MaterializedAsset>; extensions: Set<string> }> {
  const assets = new Map<string, MaterializedAsset>()
  const extensions = new Set<string>()
  const entryNames = new Set<string>()
  const materialize = async (assetId: string): Promise<void> => {
    if (assets.has(assetId)) return
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
  for (const slideId of document.slideOrder) {
    const slide = document.slides[slideId]
    if (!slide) throw new Error(`PPTX generation slide missing: ${slideId}`)
    for (const assetId of slideAssetReferences(document, slideId)) await materialize(assetId)
  }
  // Masters and layouts come after the slides, so slide media keeps the part names it already had; a
  // photo they share with a slide is already materialized and only gains a second relationship.
  for (const assetId of inheritedAssetReferences(document)) await materialize(assetId)
  return { assets, extensions }
}

function serializeSlideElements(
  document: Ppt4aiDocument,
  slideId: string,
  assets: Map<string, MaterializedAsset>,
  plan: { layoutNumber: number; layout?: SlideLayout; master?: SlideMaster },
): SlideSerialization {
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
  // Because an override is written complete, resolving against the master and layout this slide names
  // keeps its colours right even when that pair is not the one its layout part descends from.
  return {
    xml: serializeSlideXml(
      serializedElements,
      slide.background,
      backgroundAsset ? relationshipFor(backgroundAsset) : undefined,
      effectiveColorMap([plan.master?.colorMap, plan.layout?.colorMapOverride], slide.colorMapOverride),
    ),
    relationships: serializeSlideRelationshipsXml(imageRelationships, plan.layoutNumber),
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

/**
 * The parts the package will hold, and which of them each slide, master and layout points at. Numbering
 * follows the model ids in sorted order so two structurally equal documents export equal bytes, and a
 * document with one master keeps the numbering it had before several were possible.
 *
 * A model with no masters or no layouts still gets one of each: a layout has to belong to a master, and
 * a package has to have both.
 */
interface InheritancePlan {
  masters: ReadonlyArray<SlideMaster | undefined>
  layouts: ReadonlyArray<SlideLayout | undefined>
  themes: ReadonlyArray<Theme | undefined>
  /** Per slide, in slide order: its layout part number and the pair its colours resolve against. */
  slides: ReadonlyArray<{ layoutNumber: number; layout?: SlideLayout; master?: SlideMaster }>
  parts: PackageParts
}

function planInheritance(document: Ppt4aiDocument, hasTableStyles: boolean): InheritancePlan {
  const modeled = <T>(map: Record<string, T> | undefined): Array<T | undefined> => Object.keys(map ?? {}).sort().map((id) => map?.[id])
  const masters = modeled(document.masters)
  const layouts = modeled(document.layouts)
  const masterList = masters.length > 0 ? masters : [undefined]
  const layoutList = layouts.length > 0 ? layouts : [undefined]
  // One theme part per distinct theme a master names, so each master's colours and fonts travel with it.
  const themeIds: string[] = []
  for (const master of masterList) {
    const themeId = master?.themeId
    if (themeId && document.themes?.[themeId] && !themeIds.includes(themeId)) themeIds.push(themeId)
  }
  const themes = themeIds.length > 0 ? themeIds.map((id) => document.themes?.[id]) : [effectiveTheme(document)]
  const masterNumbers = new Map(masterList.map((master, index) => [master?.id ?? '', index + 1]))
  const layoutNumbers = new Map(layoutList.map((layout, index) => [layout?.id ?? '', index + 1]))
  // A layout whose master the model does not hold belongs to the first master rather than to nothing.
  const ownerOf = (layout: SlideLayout | undefined): number => masterNumbers.get(layout?.masterId ?? '') ?? 1
  const masterLayouts = masterList.map((_, index) => layoutList.flatMap((layout, layoutIndex) => ownerOf(layout) === index + 1 ? [layoutIndex + 1] : []))
  const slides = document.slideOrder.map((slideId) => {
    const slide = document.slides[slideId]
    const named = slide?.layoutId ? layoutNumbers.get(slide.layoutId) : undefined
    const masterNumber = slide?.masterId ? masterNumbers.get(slide.masterId) : undefined
    const layoutNumber = named ?? (masterNumber ? masterLayouts[masterNumber - 1]?.[0] : undefined) ?? 1
    const layout = layoutList[layoutNumber - 1]
    const master = (masterNumber ? masterList[masterNumber - 1] : undefined) ?? masterList[ownerOf(layout) - 1]
    return { layoutNumber, ...(layout ? { layout } : {}), ...(master ? { master } : {}) }
  })
  return {
    masters: masterList,
    layouts: layoutList,
    themes,
    slides,
    parts: {
      slideCount: document.slideOrder.length,
      masterCount: masterList.length,
      layoutCount: layoutList.length,
      themeCount: themes.length,
      hasTableStyles,
      slideLayouts: slides.map((slide) => slide.layoutNumber),
      masterLayouts,
      masterThemes: masterList.map((master) => {
        const index = master?.themeId ? themeIds.indexOf(master.themeId) : -1
        return index >= 0 ? index + 1 : 1
      }),
    },
  }
}

/**
 * `CT_ColorMapping` requires all twelve slots, so an override is written whole: the model's partial
 * override is merged onto what it inherits first. No stated override writes `a:masterClrMapping`, which
 * is the file's way of saying the same thing the absent field says.
 */
function effectiveColorMap(overlays: Array<Partial<ColorMap> | undefined>, stated: Partial<ColorMap> | undefined): ColorMap | undefined {
  return stated && Object.keys(stated).length > 0 ? mergeColorMaps(...overlays, stated) : undefined
}

/**
 * The image relationship a master or layout needs for its own background. The media part is shared with
 * whoever else uses that photo — one part per asset — while each part carries its own relationship to it,
 * which is what OOXML asks for.
 */
function backgroundRelationship(
  background: SlideBackground | undefined,
  assets: Map<string, MaterializedAsset>,
  relationshipId: string,
): { id?: string; relationships: string[] } {
  const assetId = background?.pictureFill?.assetId
  const asset = assetId ? assets.get(assetId) : undefined
  if (!asset) return { relationships: [] }
  return {
    id: relationshipId,
    relationships: [serializeImageRelationship(relationshipId, `../media/${asset.path.slice('ppt/media/'.length)}`)],
  }
}

function skeletonEntries(
  document: Ppt4aiDocument,
  slides: SlideSerialization[],
  materialized: Map<string, MaterializedAsset>,
  imageExtensions: Set<string>,
  plan: InheritancePlan,
): ZipEntry[] {
  const slideCount = document.slideOrder.length
  const support = serializePresentationSupportXml()
  const encoder = new TextEncoder()
  // No styles means no part: an empty `a:tblStyleLst` carries no information and its required `def`
  // would have nothing to name. A table's `tableStyleId` is left alone either way — Office resolves its
  // built-in styles from its own gallery, so a reference this package cannot answer is still valid.
  const tableStyles = document.tableStyles && Object.keys(document.tableStyles).length > 0 ? document.tableStyles : undefined
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: encoder.encode(serializeContentTypesXml(plan.parts, imageExtensions)) },
    { name: '_rels/.rels', data: encoder.encode(serializeRootRelationshipsXml()) },
    { name: 'docProps/core.xml', data: encoder.encode(serializeCorePropertiesXml()) },
    { name: 'docProps/app.xml', data: encoder.encode(serializeAppPropertiesXml()) },
    { name: 'ppt/presentation.xml', data: encoder.encode(serializePresentationXml(document.page, plan.parts)) },
    { name: 'ppt/_rels/presentation.xml.rels', data: encoder.encode(serializePresentationRelationshipsXml(plan.parts)) },
    { name: 'ppt/presProps.xml', data: encoder.encode(support.presProps) },
    { name: 'ppt/viewProps.xml', data: encoder.encode(support.viewProps) },
    ...plan.themes.map((theme, index) => ({ name: `ppt/theme/theme${index + 1}.xml`, data: encoder.encode(serializeThemeXml(theme)) })),
    ...(tableStyles ? [{ name: 'ppt/tableStyles.xml', data: encoder.encode(serializeTableStylesXml(tableStyles)) }] : []),
    ...plan.masters.flatMap((master, index) => {
      const layoutNumbers = plan.parts.masterLayouts[index] ?? []
      const background = backgroundRelationship(master?.background, materialized, `rId${layoutNumbers.length + 2}`)
      return [
        {
          name: `ppt/slideMasters/slideMaster${index + 1}.xml`,
          data: encoder.encode(serializeMasterXml(master, mergeColorMaps(master?.colorMap), layoutNumbers, plan.parts.masterCount, background.id)),
        },
        {
          name: `ppt/slideMasters/_rels/slideMaster${index + 1}.xml.rels`,
          data: encoder.encode(serializeMasterRelationshipsXml(layoutNumbers, plan.parts.masterThemes[index] ?? 1, background.relationships)),
        },
      ]
    }),
    ...plan.layouts.flatMap((layout, index) => {
      const owner = plan.parts.masterLayouts.findIndex((numbers) => numbers.includes(index + 1))
      const master = plan.masters[owner === -1 ? 0 : owner]
      const background = backgroundRelationship(layout?.background, materialized, 'rId2')
      return [
        {
          name: `ppt/slideLayouts/slideLayout${index + 1}.xml`,
          data: encoder.encode(serializeLayoutXml(layout, effectiveColorMap([master?.colorMap], layout?.colorMapOverride), background.id)),
        },
        {
          name: `ppt/slideLayouts/_rels/slideLayout${index + 1}.xml.rels`,
          data: encoder.encode(serializeLayoutRelationshipsXml(owner === -1 ? 1 : owner + 1, background.relationships)),
        },
      ]
    }),
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
  const hasTableStyles = Object.keys(document.tableStyles ?? {}).length > 0
  const plan = planInheritance(document, hasTableStyles)
  const slides = document.slideOrder.map((slideId, index) => serializeSlideElements(document, slideId, materialized.assets, plan.slides[index] ?? { layoutNumber: 1 }))
  return writeStoredZip(skeletonEntries(document, slides, materialized.assets, materialized.extensions, plan))
}

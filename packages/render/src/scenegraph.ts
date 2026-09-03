import { boundsCentre, cascadeTransform, createPresetPath, mapChildSpace, type GroupTransform, type PathCommand } from '@ppt4ai/geometry'
import { layoutTable, type TableLayout, type TableLayoutCell } from '@ppt4ai/layout'
import { mergeColorMaps, resolveColor, resolveInheritedElement, resolveStyleFill, resolveStyleLine, resolveTableCellStyle, resolveThemeFontFamily, type AssetMetadata, type ColorMap, type Element, type ElementTransform, type Fill, type ImageCrop, type ImageEffect, type LevelDefaults, type Ppt4aiDocument, type PresetGeometry, type Rect, type ResolvedColor, type ResolvedTableCellStyle, type ShapeStyleReference, type SlideLayout, type SlideMaster, type TableCellBorders, type TableStyleText, type TextBody, type TextMarks, type Theme } from '@ppt4ai/model'
import { layoutText, normalizeTextElement, type TextLayout, type TextLayoutLine, type TextLayoutMarker, type TextLayoutRun } from '@ppt4ai/text'

export interface SceneGraph {
  slideId: string
  page: {
    w: number
    h: number
  }
  nodes: SceneNode[]
  groups?: SceneGroup[]
}

export interface SceneGroup {
  id: string
  bounds: Rect
  childIds: string[]
  ancestorIds: string[]
  paintOrder: number
  rotation?: number
  flipH?: boolean
  flipV?: boolean
}

export interface SceneShapeNode {
  id: string
  kind: 'shape'
  bounds: Rect
  path: PathCommand[]
  fill?: Fill
  stroke?: Fill
  resolvedFillColor?: ResolvedColor
  resolvedStrokeColor?: ResolvedColor
  transform?: ElementTransform
}

export interface SceneTextLayoutRun extends TextLayoutRun {
  resolvedColor?: ResolvedColor
  resolvedFontFamily?: string
}

/** Present only when the theme resolved the run's `+mj-lt`-style reference into a real typeface. */
export interface SceneTextLayoutMarker extends TextLayoutMarker {
  resolvedFontFamily?: string
}

export interface SceneTextLayoutLine extends Omit<TextLayoutLine, 'runs' | 'marker'> {
  runs: SceneTextLayoutRun[]
  marker?: SceneTextLayoutMarker
}

export interface SceneTextLayout extends Omit<TextLayout, 'lines'> {
  lines: SceneTextLayoutLine[]
}

export interface SceneTextNode {
  id: string
  kind: 'text'
  bounds: Rect
  text: string
  layout: SceneTextLayout
  /** Present when the element carries a fill or stroke, so the text sits on real geometry. */
  path?: PathCommand[]
  fill?: Fill
  stroke?: Fill
  resolvedFillColor?: ResolvedColor
  resolvedStrokeColor?: ResolvedColor
  transform?: ElementTransform
}

export interface SceneTableNode {
  id: string
  kind: 'table'
  bounds: Rect
  layout: SceneTableLayout
  fill?: Fill
  stroke?: Fill
  transform?: ElementTransform
}

export interface SceneImageNode {
  id: string
  kind: 'image'
  bounds: Rect
  assetId: string
  metadata?: AssetMetadata
  transform?: ElementTransform
  sourceCrop?: ImageCrop
  maskPreset?: PresetGeometry
  effects?: ImageEffect[]
}

export interface SceneTableLayoutCell extends TableLayoutCell {
  textLayout: SceneTextLayout
  resolvedStyle: ResolvedTableCellStyle
  resolvedFillColor?: ResolvedColor
  resolvedBorderColors?: Partial<Record<keyof TableCellBorders, ResolvedColor>>
  resolvedTextStyle?: SceneResolvedTableTextStyle
}

export interface SceneTableLayout extends Omit<TableLayout, 'cells'> {
  cells: SceneTableLayoutCell[]
}

export type SceneNode = SceneShapeNode | SceneTextNode | SceneTableNode | SceneImageNode

export interface SceneResolvedTableTextStyle extends Omit<TableStyleText, 'color'> {
  color?: ResolvedColor
}

interface SceneThemeContext {
  theme?: Theme
  colorMap: ColorMap
}

function resolvedFillColor(fill: Fill | undefined, context: SceneThemeContext): ResolvedColor | undefined {
  return fill ? resolveColor(fill.color, context.theme, context.colorMap) : undefined
}

/**
 * Picks the typeface slot the layout asked for, then lets the theme resolve any `+mj-lt`-style
 * reference. Only set when the result differs from what paint would use anyway (`marks.fontFamily`),
 * so text with neither a script font nor a theme reference keeps the same scene shape as before.
 */
function resolvedFontFamily(marks: TextMarks | undefined, script: 'ea' | undefined, context: SceneThemeContext): string | undefined {
  const requested = script === 'ea' ? marks?.fontFamilyEa ?? marks?.fontFamily : marks?.fontFamily
  const resolved = resolveThemeFontFamily(requested, context.theme)
  return resolved === marks?.fontFamily ? undefined : resolved
}

function toSceneTextLayout(layout: TextLayout, context: SceneThemeContext): SceneTextLayout {
  return {
    ...layout,
    lines: layout.lines.map((line) => {
      const markerFontFamily = line.marker ? resolvedFontFamily(line.marker.marks, line.marker.script, context) : undefined
      return {
        ...line,
        ...(line.marker ? { marker: { ...line.marker, ...(markerFontFamily ? { resolvedFontFamily: markerFontFamily } : {}) } } : {}),
        runs: line.runs.map((run) => {
          const resolvedColor = resolvedFillColor(run.marks?.color, context)
          const fontFamily = resolvedFontFamily(run.marks, run.script, context)
          return { ...run, ...(resolvedColor ? { resolvedColor } : {}), ...(fontFamily ? { resolvedFontFamily: fontFamily } : {}) }
        }),
      }
    }),
  }
}

function mergeTableTextDefaults(body: TextBody, text: TableStyleText | undefined): TextBody {
  const clonedBody = structuredClone(body)
  if (!text) return clonedBody
  const defaults: TextMarks = {
    ...(text.color ? { color: { color: structuredClone(text.color) } } : {}),
    ...(text.bold === undefined ? {} : { bold: text.bold }),
    ...(text.italic === undefined ? {} : { italic: text.italic }),
  }
  return {
    ...clonedBody,
    paragraphs: clonedBody.paragraphs.map((paragraph) => ({
      ...paragraph,
      runs: paragraph.runs.map((run) => ({
        ...run,
        marks: { ...defaults, ...run.marks },
      })),
    })),
  }
}

function mergeLevelDefaults(
  body: TextBody,
  element: Extract<Element, { kind: 'text' }>,
  layout: SlideLayout | undefined,
  master: SlideMaster | undefined,
): TextBody {
  const clonedBody = structuredClone(body)
  const placeholderType = element.placeholder
  const textStyleKey: 'title' | 'body' | 'other' = placeholderType === 'title' || placeholderType === 'subTitle' || placeholderType === 'ctrTitle'
    ? 'title'
    : placeholderType === 'body'
      ? 'body'
      : 'other'

  return {
    ...clonedBody,
    paragraphs: clonedBody.paragraphs.map((paragraph) => {
      const level = paragraph.attrs?.level ?? 0
      const defaults = paragraph.attrs?.defaultMarks
      const listStyle = layout?.defaults?.[placeholderType ?? 'body']?.listStyle
      const textStyles = master?.textStyles?.[textStyleKey]

      const levelListStyle = listStyle?.find((item: LevelDefaults) => item.level === level)
      const levelTextStyle = textStyles?.find((item: LevelDefaults) => item.level === level)

      const merged: TextMarks = {
        ...levelTextStyle?.marks,
        ...levelListStyle?.marks,
        ...defaults,
      }

      return {
        ...paragraph,
        runs: paragraph.runs.map((run) => ({
          ...run,
          marks: { ...merged, ...run.marks },
        })),
      }
    }),
  }
}

function resolveBorderColors(borders: TableCellBorders, context: SceneThemeContext): Partial<Record<keyof TableCellBorders, ResolvedColor>> | undefined {
  const colors: Partial<Record<keyof TableCellBorders, ResolvedColor>> = {}
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const color = borders[side] ? resolveColor(borders[side].color, context.theme, context.colorMap) : undefined
    if (color) colors[side] = color
  }
  return Object.keys(colors).length > 0 ? colors : undefined
}

function resolveTableTextStyle(text: TableStyleText | undefined, context: SceneThemeContext): SceneResolvedTableTextStyle | undefined {
  if (!text) return undefined
  const color = text.color ? resolveColor(text.color, context.theme, context.colorMap) : undefined
  const resolved = {
    ...(color ? { color } : {}),
    ...(text.bold === undefined ? {} : { bold: text.bold }),
    ...(text.italic === undefined ? {} : { italic: text.italic }),
  }
  return Object.keys(resolved).length > 0 ? resolved : undefined
}

/** Builds the scene-level transform from the bare model fields, omitted when nothing is set. */
function elementTransform(element: { rotation?: number; flipH?: boolean; flipV?: boolean }): ElementTransform | undefined {
  const transform: ElementTransform = {
    ...(element.rotation ? { rotation: element.rotation } : {}),
    ...(element.flipH ? { flipH: true } : {}),
    ...(element.flipV ? { flipV: true } : {}),
  }
  return Object.keys(transform).length > 0 ? transform : undefined
}

/**
 * Direct formatting wins; the shape style matrix is the fallback, which is what a shape built from
 * PowerPoint's style gallery relies on. The resolved colour stays in the scene — writing it into
 * `element.fill` would turn "follows the theme style" into a pinned colour on the next writeback.
 */
function shapeFillColor(element: { fill?: Fill; styleRef?: ShapeStyleReference }, context: SceneThemeContext): ResolvedColor | undefined {
  return resolvedFillColor(element.fill, context) ?? resolveStyleFill(element.styleRef?.fill, context.theme, context.colorMap)
}

function shapeStrokeColor(element: { stroke?: Fill; styleRef?: ShapeStyleReference }, context: SceneThemeContext): ResolvedColor | undefined {
  return resolvedFillColor(element.stroke, context) ?? resolveStyleLine(element.styleRef?.line, context.theme, context.colorMap)
}

function createShapeNode(element: Extract<Element, { kind: 'shape' }>, context: SceneThemeContext): SceneShapeNode {
  const node: SceneShapeNode = {
    id: element.id,
    kind: 'shape',
    bounds: element.bounds,
    path: createPresetPath(element.preset, element.bounds),
  }

  if (element.fill) node.fill = element.fill
  if (element.stroke) node.stroke = element.stroke
  const fillColor = shapeFillColor(element, context)
  const strokeColor = shapeStrokeColor(element, context)
  if (fillColor) node.resolvedFillColor = fillColor
  if (strokeColor) node.resolvedStrokeColor = strokeColor
  const transform = elementTransform(element)
  if (transform) node.transform = transform
  return node
}

function createTextNode(
  element: Extract<Element, { kind: 'text' }>,
  context: SceneThemeContext,
  layout: SlideLayout | undefined,
  master: SlideMaster | undefined,
): SceneTextNode {
  const normalized = normalizeTextElement(element)
  const body = mergeLevelDefaults(normalized, element, layout, master)
  const node: SceneTextNode = {
    id: element.id,
    kind: 'text',
    bounds: element.bounds,
    text: element.text ?? body.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n'),
    layout: toSceneTextLayout(layoutText({ bounds: element.bounds, body }), context),
  }
  if (element.fill) node.fill = element.fill
  if (element.stroke) node.stroke = element.stroke
  const fillColor = shapeFillColor(element, context)
  const strokeColor = shapeStrokeColor(element, context)
  // A shape that carries text still paints its own geometry, whether the colour came from the shape
  // or from the theme style matrix. Plain text keeps the scene shape it had before, and `rect`
  // covers a filled text box whose source declared no geometry.
  if (fillColor || strokeColor) node.path = createPresetPath(element.preset ?? 'rect', element.bounds)
  if (fillColor) node.resolvedFillColor = fillColor
  if (strokeColor) node.resolvedStrokeColor = strokeColor
  const transform = elementTransform(element)
  if (transform) node.transform = transform
  return node
}

function createTableNode(element: Extract<Element, { kind: 'table' }>, context: SceneThemeContext, tableStyles?: Ppt4aiDocument['tableStyles']): SceneTableNode {
  const tableLayout = layoutTable(element)
  const node: SceneTableNode = {
    id: element.id,
    kind: 'table',
    bounds: { ...element.bounds },
    layout: {
      ...tableLayout,
      cells: tableLayout.cells.map((cell) => {
        const sourceCell = element.rows[cell.row]?.cells.find((candidate) => candidate.column === cell.column)
        if (!sourceCell) throw new Error(`table layout references missing cell: ${element.id}[${cell.row},${cell.column}]`)
        const resolvedStyle = resolveTableCellStyle(element, sourceCell, cell.row, cell.column, tableStyles)
        const fillColor = resolvedFillColor(resolvedStyle.fill, context)
        const borderColors = resolveBorderColors(resolvedStyle.borders, context)
        const textStyle = resolveTableTextStyle(resolvedStyle.text, context)
        const body = mergeTableTextDefaults(cell.body, resolvedStyle.text)
        return {
          ...cell,
          resolvedStyle,
          textLayout: toSceneTextLayout(layoutText({ bounds: cell.bounds, body }), context),
          ...(fillColor ? { resolvedFillColor: fillColor } : {}),
          ...(borderColors ? { resolvedBorderColors: borderColors } : {}),
          ...(textStyle ? { resolvedTextStyle: textStyle } : {}),
        }
      }),
    },
  }
  if (element.fill) node.fill = structuredClone(element.fill)
  if (element.stroke) node.stroke = structuredClone(element.stroke)
  const transform = elementTransform(element)
  if (transform) node.transform = transform
  return node
}

function createImageNode(element: Extract<Element, { kind: 'image' }>, assets?: Ppt4aiDocument['assets']): SceneImageNode {
  const metadata = assets?.[element.assetId]
  return {
    id: element.id,
    kind: 'image',
    bounds: structuredClone(element.bounds),
    assetId: element.assetId,
    ...(metadata ? { metadata: structuredClone(metadata) } : {}),
    ...(element.transform ? { transform: structuredClone(element.transform) } : {}),
    ...(element.sourceCrop ? { sourceCrop: structuredClone(element.sourceCrop) } : {}),
    ...(element.maskPreset ? { maskPreset: element.maskPreset } : {}),
    ...(element.effects ? { effects: structuredClone(element.effects) } : {}),
  }
}

/**
 * A group's own space mapping plus the rotation pivot it contributes to descendants. Child space
 * mappings apply innermost-first, same as rotation, so the array is ordered outermost first.
 */
interface GroupSpace {
  childSpace?: Rect
  target: Rect
}

function applyChildSpaces(bounds: Rect, spaces: readonly GroupSpace[]): Rect {
  let mapped = bounds
  for (let index = spaces.length - 1; index >= 0; index -= 1) {
    const space = spaces[index]!
    if (space.childSpace) mapped = mapChildSpace(mapped, space.childSpace, space.target)
  }
  return mapped
}

/**
 * Cascade before the node is built, not after: text and table layouts hold absolute coordinates
 * derived from bounds, so moving bounds afterwards would leave their lines and cells behind.
 */
function cascadeElement(element: Element, ancestors: readonly GroupTransform[], spaces: readonly GroupSpace[]): Element {
  if (element.kind === 'group') return element
  const mapped = applyChildSpaces(element.bounds, spaces)
  if (element.kind === 'image') {
    const cascaded = cascadeTransform(mapped, element.transform ?? {}, ancestors)
    const transform: ElementTransform = {
      ...element.transform,
      ...(cascaded.rotation ? { rotation: cascaded.rotation } : {}),
      ...(cascaded.flipH ? { flipH: true } : {}),
      ...(cascaded.flipV ? { flipV: true } : {}),
    }
    if (!cascaded.rotation) delete transform.rotation
    if (!cascaded.flipH) delete transform.flipH
    if (!cascaded.flipV) delete transform.flipV
    return {
      ...element,
      bounds: cascaded.bounds,
      ...(Object.keys(transform).length > 0 ? { transform } : {}),
    }
  }
  const cascaded = cascadeTransform(mapped, element, ancestors)
  const flipped = { ...element, bounds: cascaded.bounds, rotation: cascaded.rotation }
  if (cascaded.flipH) flipped.flipH = true
  else delete flipped.flipH
  if (cascaded.flipV) flipped.flipV = true
  else delete flipped.flipV
  return flipped
}

function createNode(
  element: Element,
  context: SceneThemeContext,
  layout: SlideLayout | undefined,
  master: SlideMaster | undefined,
  tableStyles?: Ppt4aiDocument['tableStyles'],
  assets?: Ppt4aiDocument['assets'],
): SceneNode | undefined {
  switch (element.kind) {
    case 'shape':
      return createShapeNode(element, context)
    case 'text':
      return createTextNode(element, context, layout, master)
    case 'table':
      return createTableNode(element, context, tableStyles)
    case 'image':
      return createImageNode(element, assets)
    case 'group':
      return undefined
    default:
      return undefined
  }
}

export function documentToSceneGraph(value: Ppt4aiDocument): SceneGraph {
  const slideId = value.slideOrder[0]
  if (!slideId) throw new Error('input must contain at least one slide')

  const slide = value.slides[slideId]
  if (!slide) throw new Error(`input references missing slide: ${slideId}`)

  const nodes: SceneNode[] = []
  const layout = slide.layoutId ? value.layouts?.[slide.layoutId] : undefined
  const masterId = slide.masterId ?? layout?.masterId
  const master = masterId ? value.masters?.[masterId] : undefined
  const theme = master?.themeId ? value.themes?.[master.themeId] : undefined
  const context: SceneThemeContext = {
    colorMap: mergeColorMaps(master?.colorMap, layout?.colorMapOverride, slide.colorMapOverride),
    ...(theme ? { theme } : {}),
  }
  const visited = new Set<string>()
  const groups: SceneGroup[] = []
  const appendElement = (
    elementId: string,
    ancestorIds: string[] = [],
    ancestors: readonly GroupTransform[] = [],
    spaces: readonly GroupSpace[] = [],
  ): void => {
    if (visited.has(elementId)) return
    visited.add(elementId)
    const element = value.elements[elementId]
    if (!element) return
    if (element.kind === 'group') {
      const mappedBounds = applyChildSpaces(element.bounds, spaces)
      const cascaded = cascadeTransform(mappedBounds, element, ancestors)
      const groupIndex = groups.push({
        id: element.id,
        bounds: cascaded.bounds === element.bounds ? structuredClone(element.bounds) : cascaded.bounds,
        childIds: [...element.childIds],
        ancestorIds: [...ancestorIds],
        paintOrder: nodes.length - 1,
        ...(cascaded.rotation ? { rotation: cascaded.rotation } : {}),
        ...(cascaded.flipH ? { flipH: true } : {}),
        ...(cascaded.flipV ? { flipV: true } : {}),
      }) - 1
      // Descendants are mapped into this group's on-slide box before any outer mapping applies.
      const childSpaces: GroupSpace[] = [
        ...spaces,
        { ...(element.childSpace ? { childSpace: element.childSpace } : {}), target: element.bounds },
      ]
      // The pivot is the group's mapped centre: child space applies before rotation and mirroring.
      const childAncestors = element.rotation || element.flipH || element.flipV
        ? [...ancestors, {
            pivot: boundsCentre(mappedBounds),
            ...(element.rotation ? { rotation: element.rotation } : {}),
            ...(element.flipH ? { flipH: true } : {}),
            ...(element.flipV ? { flipV: true } : {}),
          }]
        : ancestors
      for (const childId of element.childIds) appendElement(childId, [...ancestorIds, element.id], childAncestors, childSpaces)
      groups[groupIndex]!.paintOrder = nodes.length - 1
      return
    }
    const inherited = resolveInheritedElement(element, layout, master)
    const cascaded = ancestors.length > 0 || spaces.length > 0
      ? cascadeElement(inherited, ancestors, spaces)
      : inherited
    const node = createNode(cascaded, context, layout, master, value.tableStyles, value.assets)
    if (node) nodes.push(node)
  }
  for (const elementId of slide.elementIds) appendElement(elementId)

  return {
    slideId,
    page: { ...value.page },
    nodes,
    ...(groups.length > 0 ? { groups } : {}),
  }
}

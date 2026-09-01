import { boundsCentre, cascadeRotation, createPresetPath, mapChildSpace, type PathCommand, type RotationPivot } from '@ppt4ai/geometry'
import { layoutTable, type TableLayout, type TableLayoutCell } from '@ppt4ai/layout'
import { mergeColorMaps, resolveColor, resolveInheritedElement, resolveTableCellStyle, type AssetMetadata, type ColorMap, type Element, type ElementTransform, type Fill, type ImageCrop, type ImageEffect, type Ppt4aiDocument, type PresetGeometry, type Rect, type ResolvedColor, type ResolvedTableCellStyle, type TableCellBorders, type TableStyleText, type TextBody, type TextMarks, type Theme } from '@ppt4ai/model'
import { layoutText, normalizeTextElement, type TextLayout, type TextLayoutLine, type TextLayoutRun } from '@ppt4ai/text'

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
}

export interface SceneTextLayoutLine extends Omit<TextLayoutLine, 'runs'> {
  runs: SceneTextLayoutRun[]
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

interface SceneColorContext {
  theme?: Theme
  colorMap: ColorMap
}

function resolvedFillColor(fill: Fill | undefined, context: SceneColorContext): ResolvedColor | undefined {
  return fill ? resolveColor(fill.color, context.theme, context.colorMap) : undefined
}

function toSceneTextLayout(layout: TextLayout, context: SceneColorContext): SceneTextLayout {
  return {
    ...layout,
    lines: layout.lines.map((line) => ({
      ...line,
      runs: line.runs.map((run) => {
        const resolvedColor = resolvedFillColor(run.marks?.color, context)
        return { ...run, ...(resolvedColor ? { resolvedColor } : {}) }
      }),
    })),
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

function resolveBorderColors(borders: TableCellBorders, context: SceneColorContext): Partial<Record<keyof TableCellBorders, ResolvedColor>> | undefined {
  const colors: Partial<Record<keyof TableCellBorders, ResolvedColor>> = {}
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const color = borders[side] ? resolveColor(borders[side].color, context.theme, context.colorMap) : undefined
    if (color) colors[side] = color
  }
  return Object.keys(colors).length > 0 ? colors : undefined
}

function resolveTableTextStyle(text: TableStyleText | undefined, context: SceneColorContext): SceneResolvedTableTextStyle | undefined {
  if (!text) return undefined
  const color = text.color ? resolveColor(text.color, context.theme, context.colorMap) : undefined
  const resolved = {
    ...(color ? { color } : {}),
    ...(text.bold === undefined ? {} : { bold: text.bold }),
    ...(text.italic === undefined ? {} : { italic: text.italic }),
  }
  return Object.keys(resolved).length > 0 ? resolved : undefined
}

function createShapeNode(element: Extract<Element, { kind: 'shape' }>, context: SceneColorContext): SceneShapeNode {
  const node: SceneShapeNode = {
    id: element.id,
    kind: 'shape',
    bounds: element.bounds,
    path: createPresetPath(element.preset, element.bounds),
  }

  if (element.fill) node.fill = element.fill
  if (element.stroke) node.stroke = element.stroke
  const fillColor = resolvedFillColor(element.fill, context)
  const strokeColor = resolvedFillColor(element.stroke, context)
  if (fillColor) node.resolvedFillColor = fillColor
  if (strokeColor) node.resolvedStrokeColor = strokeColor
  if (element.rotation) node.transform = { rotation: element.rotation }
  return node
}

function createTextNode(element: Extract<Element, { kind: 'text' }>, context: SceneColorContext): SceneTextNode {
  const body = normalizeTextElement(element)
  const node: SceneTextNode = {
    id: element.id,
    kind: 'text',
    bounds: element.bounds,
    text: element.text ?? body.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n'),
    layout: toSceneTextLayout(layoutText({ bounds: element.bounds, body }), context),
  }
  if (element.fill) node.fill = element.fill
  if (element.stroke) node.stroke = element.stroke
  const fillColor = resolvedFillColor(element.fill, context)
  const strokeColor = resolvedFillColor(element.stroke, context)
  if (fillColor) node.resolvedFillColor = fillColor
  if (strokeColor) node.resolvedStrokeColor = strokeColor
  if (element.rotation) node.transform = { rotation: element.rotation }
  return node
}

function createTableNode(element: Extract<Element, { kind: 'table' }>, context: SceneColorContext, tableStyles?: Ppt4aiDocument['tableStyles']): SceneTableNode {
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
  if (element.rotation) node.transform = { rotation: element.rotation }
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
function cascadeElement(element: Element, ancestorRotations: readonly RotationPivot[], spaces: readonly GroupSpace[]): Element {
  if (element.kind === 'group') return element
  const mapped = applyChildSpaces(element.bounds, spaces)
  if (element.kind === 'image') {
    const cascaded = cascadeRotation(mapped, element.transform?.rotation, ancestorRotations)
    const transform: ElementTransform = {
      ...element.transform,
      ...(cascaded.rotation ? { rotation: cascaded.rotation } : {}),
    }
    if (!cascaded.rotation) delete transform.rotation
    return {
      ...element,
      bounds: cascaded.bounds,
      ...(Object.keys(transform).length > 0 ? { transform } : {}),
    }
  }
  const cascaded = cascadeRotation(mapped, element.rotation, ancestorRotations)
  return { ...element, bounds: cascaded.bounds, rotation: cascaded.rotation }
}

function createNode(
  element: Element,
  context: SceneColorContext,
  tableStyles?: Ppt4aiDocument['tableStyles'],
  assets?: Ppt4aiDocument['assets'],
): SceneNode | undefined {
  switch (element.kind) {
    case 'shape':
      return createShapeNode(element, context)
    case 'text':
      return createTextNode(element, context)
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
  const context: SceneColorContext = {
    colorMap: mergeColorMaps(master?.colorMap, layout?.colorMapOverride, slide.colorMapOverride),
    ...(theme ? { theme } : {}),
  }
  const visited = new Set<string>()
  const groups: SceneGroup[] = []
  const appendElement = (
    elementId: string,
    ancestorIds: string[] = [],
    ancestorRotations: readonly RotationPivot[] = [],
    spaces: readonly GroupSpace[] = [],
  ): void => {
    if (visited.has(elementId)) return
    visited.add(elementId)
    const element = value.elements[elementId]
    if (!element) return
    if (element.kind === 'group') {
      const mappedBounds = applyChildSpaces(element.bounds, spaces)
      const cascaded = cascadeRotation(mappedBounds, element.rotation, ancestorRotations)
      const groupIndex = groups.push({
        id: element.id,
        bounds: cascaded.bounds === element.bounds ? structuredClone(element.bounds) : cascaded.bounds,
        childIds: [...element.childIds],
        ancestorIds: [...ancestorIds],
        paintOrder: nodes.length - 1,
        ...(cascaded.rotation ? { rotation: cascaded.rotation } : {}),
      }) - 1
      // Descendants are mapped into this group's on-slide box before any outer mapping applies.
      const childSpaces: GroupSpace[] = [
        ...spaces,
        { ...(element.childSpace ? { childSpace: element.childSpace } : {}), target: element.bounds },
      ]
      // The pivot is the group's mapped centre: child space applies before rotation.
      const childRotations = element.rotation
        ? [...ancestorRotations, { pivot: boundsCentre(mappedBounds), rotation: element.rotation }]
        : ancestorRotations
      for (const childId of element.childIds) appendElement(childId, [...ancestorIds, element.id], childRotations, childSpaces)
      groups[groupIndex]!.paintOrder = nodes.length - 1
      return
    }
    const inherited = resolveInheritedElement(element, layout, master)
    const cascaded = ancestorRotations.length > 0 || spaces.length > 0
      ? cascadeElement(inherited, ancestorRotations, spaces)
      : inherited
    const node = createNode(cascaded, context, value.tableStyles, value.assets)
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

import { createPresetPath, type PathCommand } from '@ppt4ai/geometry'
import { layoutTable, type TableLayout, type TableLayoutCell } from '@ppt4ai/layout'
import { mergeColorMaps, resolveColor, resolveInheritedElement, resolveTableCellStyle, type ColorMap, type Element, type Fill, type Ppt4aiDocument, type Rect, type ResolvedColor, type ResolvedTableCellStyle, type TableCellBorders, type TableStyleText, type TextBody, type TextMarks, type Theme } from '@ppt4ai/model'
import { layoutText, normalizeTextElement, type TextLayout, type TextLayoutLine, type TextLayoutRun } from '@ppt4ai/text'

export interface SceneGraph {
  slideId: string
  page: {
    w: number
    h: number
  }
  nodes: SceneNode[]
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
}

export interface SceneTableNode {
  id: string
  kind: 'table'
  bounds: Rect
  layout: SceneTableLayout
  fill?: Fill
  stroke?: Fill
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

export type SceneNode = SceneShapeNode | SceneTextNode | SceneTableNode

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
  return node
}

function createNode(element: Element, context: SceneColorContext, tableStyles?: Ppt4aiDocument['tableStyles']): SceneNode | undefined {
  switch (element.kind) {
    case 'shape':
      return createShapeNode(element, context)
    case 'text':
      return createTextNode(element, context)
    case 'table':
      return createTableNode(element, context, tableStyles)
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
  const appendElement = (elementId: string): void => {
    if (visited.has(elementId)) return
    visited.add(elementId)
    const element = value.elements[elementId]
    if (!element) return
    if (element.kind === 'group') {
      for (const childId of element.childIds) appendElement(childId)
      return
    }
    const node = createNode(resolveInheritedElement(element, layout, master), context, value.tableStyles)
    if (node) nodes.push(node)
  }
  for (const elementId of slide.elementIds) appendElement(elementId)

  return {
    slideId,
    page: { ...value.page },
    nodes,
  }
}

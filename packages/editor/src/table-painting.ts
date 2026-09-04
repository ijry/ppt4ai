import type { Rect, ResolvedColor, TableBorder, TableCellBorders } from '@ppt4ai/model'
import type { SceneTableLayoutCell, SceneTableNode } from '@ppt4ai/render'
import { withRotation } from './rotation-transform'
import { dashPattern } from './shape-painting'
import { paintTextLayout, type TextPageMapping } from './text-painting'

export interface TablePageMapping extends TextPageMapping {}

type TableContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type BorderSide = keyof TableCellBorders

const DEFAULT_BORDER_WIDTH = 12700
const borderSides: BorderSide[] = ['left', 'right', 'top', 'bottom']

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`)
  return value
}

function dimension(value: number, name: string): number {
  finite(value, name)
  if (value < 0) throw new Error(`${name} must be non-negative`)
  return value
}

function validateMapping(mapping: TablePageMapping): void {
  finite(mapping.scale, 'table mapping scale')
  if (mapping.scale <= 0) throw new Error('table mapping scale must be positive')
  finite(mapping.offsetX, 'table mapping offsetX')
  finite(mapping.offsetY, 'table mapping offsetY')
}

function validateRect(rect: Rect, name: string): void {
  finite(rect.x, `${name} x`)
  finite(rect.y, `${name} y`)
  dimension(rect.w, `${name} width`)
  dimension(rect.h, `${name} height`)
}

function colorState(color: ResolvedColor, name: string): { color: string; alpha: number } {
  if (!/^[0-9A-Fa-f]{6}$/.test(color.rgb)) throw new Error(`${name} must be six hexadecimal digits`)
  if (!Number.isFinite(color.alpha) || color.alpha < 0 || color.alpha > 100000) {
    throw new Error(`${name} alpha must be between 0 and 100000`)
  }
  return { color: `#${color.rgb.toUpperCase()}`, alpha: color.alpha / 100000 }
}

function mappedRect(rect: Rect, mapping: TablePageMapping): Rect {
  return {
    x: mapping.offsetX + rect.x * mapping.scale,
    y: mapping.offsetY + rect.y * mapping.scale,
    w: rect.w * mapping.scale,
    h: rect.h * mapping.scale,
  }
}

function paintCellFill(context: TableContext, cell: SceneTableLayoutCell, mapping: TablePageMapping): void {
  if (!cell.resolvedFillColor) return
  const style = colorState(cell.resolvedFillColor, 'table fill color')
  const bounds = mappedRect(cell.bounds, mapping)
  context.fillStyle = style.color
  context.globalAlpha = style.alpha
  context.beginPath()
  context.rect(bounds.x, bounds.y, bounds.w, bounds.h)
  context.fill()
}

const borderStyles = new Set<string>([
  'solid', 'dot', 'sysDot', 'dash', 'lgDash', 'sysDash',
  'dashDot', 'lgDashDot', 'sysDashDot', 'lgDashDotDot', 'sysDashDotDot', 'none',
])

function borderStyle(border: TableBorder): NonNullable<TableBorder['style']> {
  const style = border.style ?? 'solid'
  if (!borderStyles.has(style)) throw new Error(`unsupported table border style: ${String(style)}`)
  return style
}

function borderWidth(border: TableBorder, mapping: TablePageMapping): number {
  const width = finite(border.width ?? DEFAULT_BORDER_WIDTH, 'table border width')
  if (width < 0) throw new Error('table border width must be non-negative')
  return Math.max(1, width * mapping.scale)
}

function borderPoints(bounds: Rect, side: BorderSide): [number, number, number, number] {
  if (side === 'left') return [bounds.x, bounds.y, bounds.x, bounds.y + bounds.h]
  if (side === 'right') return [bounds.x + bounds.w, bounds.y, bounds.x + bounds.w, bounds.y + bounds.h]
  if (side === 'top') return [bounds.x, bounds.y, bounds.x + bounds.w, bounds.y]
  return [bounds.x, bounds.y + bounds.h, bounds.x + bounds.w, bounds.y + bounds.h]
}

function paintCellBorder(
  context: TableContext,
  cell: SceneTableLayoutCell,
  side: BorderSide,
  mapping: TablePageMapping,
): void {
  const border = cell.resolvedStyle.borders[side]
  if (!border) return
  const style = borderStyle(border)
  const width = borderWidth(border, mapping)
  const resolvedColor = cell.resolvedBorderColors?.[side]
  if (style === 'none' || !resolvedColor) return
  const color = colorState(resolvedColor, 'table border color')
  const bounds = mappedRect(cell.bounds, mapping)
  const [fromX, fromY, toX, toY] = borderPoints(bounds, side)
  context.strokeStyle = color.color
  context.globalAlpha = color.alpha
  context.lineWidth = width
  context.lineCap = 'butt'
  context.setLineDash(dashPattern(style, width))
  context.beginPath()
  context.moveTo(fromX, fromY)
  context.lineTo(toX, toY)
  context.stroke()
}

export function paintTableNode(context: TableContext, node: SceneTableNode, mapping: TablePageMapping): void {
  context.save()
  try {
    validateMapping(mapping)
    validateRect(node.bounds, 'table bounds')
    validateRect(node.layout.bounds, 'table layout bounds')
    for (const cell of node.layout.cells) validateRect(cell.bounds, 'table cell bounds')
    withRotation(context, mappedRect(node.bounds, mapping), node.transform, () => {
      for (const cell of node.layout.cells) paintCellFill(context, cell, mapping)
      for (const cell of node.layout.cells) {
        for (const side of borderSides) paintCellBorder(context, cell, side, mapping)
      }
      for (const cell of node.layout.cells) paintTextLayout(context, cell.textLayout, mapping)
    })
  } finally {
    context.restore()
  }
}

import type { Rect, ResolvedColor, TableBorder, TableCellBorders } from '@ppt4ai/model'
import type { SceneTableLayoutCell, SceneTableNode } from '@ppt4ai/render'
import type { DecodedImage } from './image-canvas-renderer'
import { withRotation } from './rotation-transform'
import { dashPattern, fillGradient, paintPatternFill, paintPictureFill } from './shape-painting'
import { paintTextLayout, type TextPageMapping } from './text-painting'

export interface TablePageMapping extends TextPageMapping {}

type TableContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type BorderSide = keyof TableCellBorders

const DEFAULT_BORDER_WIDTH = 12700
/** The diagonals come last, so they sit on top of the four sides rather than under them. */
const borderSides: BorderSide[] = ['left', 'right', 'top', 'bottom', 'tlToBr', 'blToTr']

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

function paintCellFill(
  context: TableContext,
  cell: SceneTableLayoutCell,
  mapping: TablePageMapping,
  pictures?: ReadonlyMap<string, DecodedImage>,
): void {
  const picture = cell.pictureFill ? pictures?.get(cell.pictureFill.assetId) : undefined
  if (cell.pictureFill && picture) {
    const bounds = mappedRect(cell.bounds, mapping)
    // The cell rectangle as a path, so the shared picture painter clips and stretches exactly as it does
    // for a shape — that is where crop, tile and the blip effects already live.
    paintPictureFill(context, [
      { type: 'move', x: cell.bounds.x, y: cell.bounds.y },
      { type: 'line', x: cell.bounds.x + cell.bounds.w, y: cell.bounds.y },
      { type: 'line', x: cell.bounds.x + cell.bounds.w, y: cell.bounds.y + cell.bounds.h },
      { type: 'line', x: cell.bounds.x, y: cell.bounds.y + cell.bounds.h },
      { type: 'close' },
    ], mapping, bounds, cell.pictureFill, picture)
    return
  }
  // A pattern paints its own two colours over the cell rectangle, the same way a shape's a:pattFill does,
  // and replaces the flat fill. A preset with no geometry falls through to the flat colour below.
  if (cell.resolvedFillPattern) {
    const bounds = mappedRect(cell.bounds, mapping)
    const painted = paintPatternFill(context, cell.resolvedFillPattern, [
      { type: 'move', x: cell.bounds.x, y: cell.bounds.y },
      { type: 'line', x: cell.bounds.x + cell.bounds.w, y: cell.bounds.y },
      { type: 'line', x: cell.bounds.x + cell.bounds.w, y: cell.bounds.y + cell.bounds.h },
      { type: 'line', x: cell.bounds.x, y: cell.bounds.y + cell.bounds.h },
      { type: 'close' },
    ], mapping, bounds)
    if (painted) return
  }
  if (!cell.resolvedFillColor) return
  const bounds = mappedRect(cell.bounds, mapping)
  // A gradient fills the cell rectangle over the mapped box, the same axis the shape painter uses; the
  // resolved colour (the first stop) stays the flat fallback for a cell that resolves no gradient.
  if (cell.resolvedFillGradient) {
    context.fillStyle = fillGradient(context, cell.resolvedFillGradient, bounds)
    context.globalAlpha = 1
  } else {
    const style = colorState(cell.resolvedFillColor, 'table fill color')
    context.fillStyle = style.color
    context.globalAlpha = style.alpha
  }
  context.beginPath()
  context.rect(bounds.x, bounds.y, bounds.w, bounds.h)
  context.fill()
}

const borderStyles = new Set<string>([
  'solid', 'dot', 'sysDot', 'dash', 'lgDash', 'sysDash',
  'dashDot', 'lgDashDot', 'sysDashDot', 'lgDashDotDot', 'sysDashDotDot', 'none',
])

/**
 * A custom dash carries its own lengths, so there is no token to check — it goes straight through to
 * `dashPattern`. Only the preset words are policed, as before.
 */
function borderStyle(border: TableBorder): NonNullable<TableBorder['style']> {
  const style = border.style ?? 'solid'
  if (typeof style === 'object') return style
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
  // The diagonals cross the cell's own rect, which for a merged cell is the whole merged block — the
  // split header a spanning cell with a diagonal is drawn for.
  if (side === 'tlToBr') return [bounds.x, bounds.y, bounds.x + bounds.w, bounds.y + bounds.h]
  if (side === 'blToTr') return [bounds.x, bounds.y + bounds.h, bounds.x + bounds.w, bounds.y]
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

/**
 * `pictures` maps an asset to its decoded bitmap. The caller loads them, because loading is asynchronous
 * and painting is not; a cell whose photo is missing paints its borders and text as before.
 */
export function paintTableNode(
  context: TableContext,
  node: SceneTableNode,
  mapping: TablePageMapping,
  pictures?: ReadonlyMap<string, DecodedImage>,
): void {
  context.save()
  try {
    validateMapping(mapping)
    validateRect(node.bounds, 'table bounds')
    validateRect(node.layout.bounds, 'table layout bounds')
    for (const cell of node.layout.cells) validateRect(cell.bounds, 'table cell bounds')
    withRotation(context, mappedRect(node.bounds, mapping), node.transform, () => {
      for (const cell of node.layout.cells) paintCellFill(context, cell, mapping, pictures)
      for (const cell of node.layout.cells) {
        for (const side of borderSides) paintCellBorder(context, cell, side, mapping)
      }
      for (const cell of node.layout.cells) paintTextLayout(context, cell.textLayout, mapping)
    })
  } finally {
    context.restore()
  }
}

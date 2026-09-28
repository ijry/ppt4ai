import type { Rect } from '@ppt4ai/model'
import type { SceneChartNode } from '@ppt4ai/render'
import { withFlipAndRotation } from './rotation-transform'
import type { ShapePageMapping } from './shape-painting'

type ChartContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function mapRect(bounds: Rect, mapping: ShapePageMapping): Rect {
  return {
    x: mapping.offsetX + bounds.x * mapping.scale,
    y: mapping.offsetY + bounds.y * mapping.scale,
    w: bounds.w * mapping.scale,
    h: bounds.h * mapping.scale,
  }
}

const CANVAS_ALIGN = { start: 'left', center: 'center', end: 'right' } as const

/** Draw the laid-out primitives (areas/bars/lines/axes/labels) mapped from EMU into the canvas. */
function paintPrimitives(context: ChartContext, node: SceneChartNode, mapping: ShapePageMapping, boxPx: Rect): void {
  const primitives = node.primitives!
  const mapX = (value: number): number => mapping.offsetX + value * mapping.scale
  const mapY = (value: number): number => mapping.offsetY + value * mapping.scale
  const trace = (points: readonly { x: number; y: number }[]): void => {
    points.forEach((point, index) => (index === 0 ? context.moveTo(mapX(point.x), mapY(point.y)) : context.lineTo(mapX(point.x), mapY(point.y))))
  }

  // Areas sit behind everything, translucent so an overlapping series still reads.
  for (const area of primitives.areas ?? []) {
    context.beginPath()
    trace(area.points)
    context.closePath()
    context.fillStyle = area.color ?? '#4472C4'
    context.globalAlpha = (mapping.alpha ?? 1) * 0.3
    context.fill()
  }
  context.globalAlpha = mapping.alpha ?? 1
  for (const bar of primitives.bars) {
    context.fillStyle = bar.color ?? '#4472C4'
    context.fillRect(mapX(bar.x), mapY(bar.y), bar.w * mapping.scale, bar.h * mapping.scale)
  }
  for (const line of primitives.polylines ?? []) {
    context.beginPath()
    trace(line.points)
    context.strokeStyle = line.color ?? '#4472C4'
    context.lineWidth = Math.max(1.5, 19050 * mapping.scale) // ~1.5pt
    context.stroke()
  }
  for (const sector of primitives.sectors ?? []) {
    const cx = mapX(sector.cx)
    const cy = mapY(sector.cy)
    const radius = sector.r * mapping.scale
    const innerRadius = sector.innerR * mapping.scale
    context.beginPath()
    if (innerRadius > 0) {
      context.arc(cx, cy, radius, sector.start, sector.end)
      context.arc(cx, cy, innerRadius, sector.end, sector.start, true)
    } else {
      context.moveTo(cx, cy)
      context.arc(cx, cy, radius, sector.start, sector.end)
    }
    context.closePath()
    context.fillStyle = sector.color ?? '#4472C4'
    context.globalAlpha = mapping.alpha ?? 1
    context.fill()
  }
  context.strokeStyle = '#868e96'
  context.lineWidth = Math.max(1, 9525 * mapping.scale) // ~0.75pt
  for (const axis of primitives.axes) {
    context.beginPath()
    context.moveTo(mapX(axis.x1), mapY(axis.y1))
    context.lineTo(mapX(axis.x2), mapY(axis.y2))
    context.stroke()
  }
  const fontPx = Math.max(8, boxPx.h * 0.04)
  context.font = `${fontPx}px sans-serif`
  context.fillStyle = '#495057'
  for (const label of primitives.labels) {
    context.textAlign = CANVAS_ALIGN[label.align]
    context.textBaseline = label.baseline
    context.fillText(label.text, mapX(label.x), mapY(label.y))
  }
}

/** The Phase 0 fallback panel, drawn when the chart type/data cannot be laid out. */
function paintPlaceholder(context: ChartContext, bounds: Rect, mapping: ShapePageMapping): void {
  context.globalAlpha = mapping.alpha ?? 1
  context.fillStyle = '#f1f3f5'
  context.fillRect(bounds.x, bounds.y, bounds.w, bounds.h)
  context.strokeStyle = '#adb5bd'
  context.lineWidth = Math.max(1, mapping.scale)
  const dash = Math.max(2, 6 * mapping.scale)
  context.setLineDash([dash, dash * 0.6])
  context.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h)
  context.setLineDash([])
  context.fillStyle = '#868e96'
  const fontPx = Math.max(10, Math.min(bounds.w, bounds.h) * 0.16)
  context.font = `${fontPx}px sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText('图表', bounds.x + bounds.w / 2, bounds.y + bounds.h / 2)
}

/**
 * Paint a chart node: its laid-out primitives when the type/data could be resolved (Phase 1), otherwise
 * a placeholder panel (Phase 0). The chart part is preserved verbatim on export regardless.
 */
export function paintChartNode(context: ChartContext, node: SceneChartNode, mapping: ShapePageMapping): void {
  const bounds = mapRect(node.bounds, mapping)
  context.save()
  try {
    withFlipAndRotation(context, bounds, node.transform, () => {
      if (node.primitives) paintPrimitives(context, node, mapping, bounds)
      else paintPlaceholder(context, bounds, mapping)
    })
  } finally {
    context.restore()
  }
}

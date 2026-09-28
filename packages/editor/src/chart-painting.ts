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

/**
 * Phase 0 placeholder for a chart: a light panel with a dashed border and a centred "图表" label. The
 * chart part is preserved verbatim through import/export; this only makes the frame visible (and, via
 * the element, selectable) on the canvas and in thumbnails until Phase 1 renders the real series.
 */
export function paintChartNode(context: ChartContext, node: SceneChartNode, mapping: ShapePageMapping): void {
  const bounds = mapRect(node.bounds, mapping)
  context.save()
  try {
    withFlipAndRotation(context, bounds, node.transform, () => {
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
    })
  } finally {
    context.restore()
  }
}

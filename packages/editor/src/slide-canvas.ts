import type { Rect } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'

const EMU_PER_CSS_PIXEL = 914400 / 96

export interface CanvasPoint {
  x: number
  y: number
}

function contains(bounds: Rect, point: CanvasPoint): boolean {
  return point.x >= bounds.x && point.x <= bounds.x + bounds.w && point.y >= bounds.y && point.y <= bounds.y + bounds.h
}

export function hitTestScene(scene: SceneGraph, point: CanvasPoint): string | undefined {
  for (let index = scene.nodes.length - 1; index >= 0; index -= 1) {
    const node = scene.nodes[index]
    if (node && contains(node.bounds, point)) return node.id
  }
  return undefined
}

export function pointFromCanvasEvent(event: Pick<PointerEvent, 'clientX' | 'clientY'>, canvas: HTMLCanvasElement, zoom: number): CanvasPoint {
  const rect = canvas.getBoundingClientRect()
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error('zoom must be positive')
  return {
    x: (event.clientX - rect.left) / (zoom / EMU_PER_CSS_PIXEL),
    y: (event.clientY - rect.top) / (zoom / EMU_PER_CSS_PIXEL),
  }
}

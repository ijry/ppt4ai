import type { ElementTransform, Rect } from '@ppt4ai/model'

/** `bounds` must be in the coordinate space `draw` paints in: the pivot is translated out and back, so `draw` keeps its own coordinates. */
export function withRotation(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  bounds: Rect,
  transform: ElementTransform | undefined,
  draw: () => void,
): void {
  if (!transform?.rotation) {
    draw()
    return
  }

  const centreX = bounds.x + bounds.w / 2
  const centreY = bounds.y + bounds.h / 2
  context.save()
  try {
    context.translate(centreX, centreY)
    context.rotate(transform.rotation * Math.PI / 10800000)
    context.translate(-centreX, -centreY)
    draw()
  } finally {
    context.restore()
  }
}

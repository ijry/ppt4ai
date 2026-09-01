import { boundsCentre, rotationRadians } from '@ppt4ai/geometry'
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

  const centre = boundsCentre(bounds)
  context.save()
  try {
    context.translate(centre.x, centre.y)
    context.rotate(rotationRadians(transform.rotation))
    context.translate(-centre.x, -centre.y)
    draw()
  } finally {
    context.restore()
  }
}

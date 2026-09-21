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

/**
 * Mirrors as well as rotates. Mirroring runs inside the rotation, the order `a:xfrm` implies and
 * the order the image painter already uses.
 *
 * Only for content a mirror is supposed to change. PowerPoint flips a shape's geometry but leaves
 * the text in it readable, so text and table painting deliberately stay on `withRotation`.
 */
export function withFlipAndRotation(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  bounds: Rect,
  transform: ElementTransform | undefined,
  draw: () => void,
): void {
  if (!transform?.flipH && !transform?.flipV) {
    withRotation(context, bounds, transform, draw)
    return
  }

  const centre = boundsCentre(bounds)
  context.save()
  try {
    context.translate(centre.x, centre.y)
    if (transform.rotation) context.rotate(rotationRadians(transform.rotation))
    context.scale(transform.flipH ? -1 : 1, transform.flipV ? -1 : 1)
    context.translate(-centre.x, -centre.y)
    draw()
  } finally {
    context.restore()
  }
}

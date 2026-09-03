import type { PathCommand } from '@ppt4ai/geometry'
import type { Rect, ResolvedColor } from '@ppt4ai/model'
import type { SceneShapeNode } from '@ppt4ai/render'
import { withFlipAndRotation } from './rotation-transform'

export interface ShapePageMapping {
  scale: number
  offsetX: number
  offsetY: number
}

type ShapeContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`)
  return value
}

function colorStyle(color: ResolvedColor): { style: string; alpha: number } {
  if (!/^[0-9A-Fa-f]{6}$/.test(color.rgb)) throw new Error('shape color must be six hexadecimal digits')
  if (!Number.isFinite(color.alpha) || color.alpha < 0 || color.alpha > 100000) {
    throw new Error('shape alpha must be between 0 and 100000')
  }
  return { style: `#${color.rgb.toUpperCase()}`, alpha: color.alpha / 100000 }
}

function validateMapping(mapping: ShapePageMapping): void {
  finite(mapping.scale, 'shape mapping scale')
  if (mapping.scale <= 0) throw new Error('shape mapping scale must be positive')
  finite(mapping.offsetX, 'shape mapping offsetX')
  finite(mapping.offsetY, 'shape mapping offsetY')
}

function mapRect(bounds: Rect, mapping: ShapePageMapping): Rect {
  return {
    x: mapping.offsetX + finite(bounds.x, 'shape bounds x') * mapping.scale,
    y: mapping.offsetY + finite(bounds.y, 'shape bounds y') * mapping.scale,
    w: finite(bounds.w, 'shape bounds w') * mapping.scale,
    h: finite(bounds.h, 'shape bounds h') * mapping.scale,
  }
}

/** Shared with text painting: a shape that carries text paints the same geometry behind its runs. */
export function tracePath(context: ShapeContext, path: readonly PathCommand[], mapping: ShapePageMapping): void {
  const mapX = (value: number): number => mapping.offsetX + finite(value, 'shape x') * mapping.scale
  const mapY = (value: number): number => mapping.offsetY + finite(value, 'shape y') * mapping.scale

  context.beginPath()
  for (const command of path) {
    if (command.type === 'move') {
      context.moveTo(mapX(command.x), mapY(command.y))
    } else if (command.type === 'line') {
      context.lineTo(mapX(command.x), mapY(command.y))
    } else if (command.type === 'arc') {
      const rx = finite(command.rx, 'shape arc rx')
      const ry = finite(command.ry, 'shape arc ry')
      if (rx < 0 || ry < 0) throw new Error('shape arc radii must be non-negative')
      context.ellipse(
        mapX(command.cx),
        mapY(command.cy),
        rx * mapping.scale,
        ry * mapping.scale,
        0,
        finite(command.start, 'shape arc start'),
        finite(command.end, 'shape arc end'),
      )
    } else {
      context.closePath()
    }
  }
}

/** Both fill and stroke retrace the path, because filling consumes it. */
export function paintPathFills(
  context: ShapeContext,
  path: readonly PathCommand[],
  mapping: ShapePageMapping,
  colors: { fill?: ResolvedColor; stroke?: ResolvedColor; strokeWidth?: number },
): void {
  const fill = colors.fill ? colorStyle(colors.fill) : undefined
  const stroke = colors.stroke ? colorStyle(colors.stroke) : undefined
  if (fill) {
    tracePath(context, path, mapping)
    context.fillStyle = fill.style
    context.globalAlpha = fill.alpha
    context.fill()
  }
  if (stroke) {
    tracePath(context, path, mapping)
    context.strokeStyle = stroke.style
    context.globalAlpha = stroke.alpha
    // Same floor table borders use: at thumbnail scale a real width lands below one pixel.
    if (colors.strokeWidth !== undefined) context.lineWidth = Math.max(1, colors.strokeWidth * mapping.scale)
    context.stroke()
  }
}

function createPath(context: ShapeContext, node: SceneShapeNode, mapping: ShapePageMapping): void {
  tracePath(context, node.path, mapping)
}

export function paintShapeNode(context: ShapeContext, node: SceneShapeNode, mapping: ShapePageMapping): void {
  context.save()
  try {
    validateMapping(mapping)
    const fill = node.resolvedFillColor ? colorStyle(node.resolvedFillColor) : undefined
    const stroke = node.resolvedStrokeColor ? colorStyle(node.resolvedStrokeColor) : undefined

    withFlipAndRotation(context, mapRect(node.bounds, mapping), node.transform, () => {
      createPath(context, node, mapping)
      if (fill) {
        createPath(context, node, mapping)
        context.fillStyle = fill.style
        context.globalAlpha = fill.alpha
        context.fill()
      }
      if (stroke) {
        createPath(context, node, mapping)
        context.strokeStyle = stroke.style
        context.globalAlpha = stroke.alpha
        if (node.strokeWidth !== undefined) context.lineWidth = Math.max(1, node.strokeWidth * mapping.scale)
        context.stroke()
      }
    })
  } finally {
    context.restore()
  }
}

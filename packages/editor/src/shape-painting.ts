import type { PathCommand } from '@ppt4ai/geometry'
import { gradientAxis } from '@ppt4ai/geometry'
import type { Rect, ResolvedColor, ResolvedGradient, StrokeCap, StrokeJoin, StrokeStyle } from '@ppt4ai/model'
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

/**
 * Canvas dash pattern for a stroke style, in the same units as the line width so a thick dash keeps
 * its proportions. Exported because table borders paint the same three styles and had their own copy.
 */
/**
 * OOXML words to canvas words. The model keeps the file's own vocabulary so the exporter can write it
 * back verbatim; the translation belongs here, in the drawing layer's dialect.
 */
export function canvasLineCap(cap: StrokeCap | undefined): CanvasLineCap {
  if (cap === 'rnd') return 'round'
  if (cap === 'sq') return 'square'
  return 'butt'
}

export function canvasLineJoin(join: StrokeJoin | undefined): CanvasLineJoin {
  return join === 'round' || join === 'bevel' ? join : 'miter'
}

export function dashPattern(style: StrokeStyle, width: number): number[] {
  if (style === 'solid') return []
  if (style === 'dash') return [4 * width, 3 * width]
  return [width, 2 * width]
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

/**
 * A canvas gradient along the axis `gradientAxis` computes for the mapped box. Stop positions are
 * thousandths of a percent in the model and a 0..1 offset on the canvas, and they are clamped
 * because `addColorStop` throws outside that range while the model only bounds each stop on its own.
 *
 * Alpha rides on the stop colour rather than `globalAlpha`, since stops can differ in transparency.
 */
function fillGradient(context: ShapeContext, gradient: ResolvedGradient, bounds: Rect): CanvasGradient {
  const axis = gradientAxis(bounds, gradient.angle ?? 0, gradient.scaled ?? false)
  const canvasGradient = context.createLinearGradient(axis.from.x, axis.from.y, axis.to.x, axis.to.y)
  for (const stop of gradient.stops) {
    const { style, alpha } = colorStyle(stop.color)
    const offset = Math.min(1, Math.max(0, stop.pos / 100000))
    canvasGradient.addColorStop(offset, alpha >= 1 ? style : rgbaStyle(style, alpha))
  }
  return canvasGradient
}

function rgbaStyle(hex: string, alpha: number): string {
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
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
  colors: {
    fill?: ResolvedColor
    fillGradient?: ResolvedGradient
    /** Needed only for a gradient: the axis is computed across the mapped box, not the path. */
    fillBounds?: Rect
    stroke?: ResolvedColor
    strokeGradient?: ResolvedGradient
    strokeBounds?: Rect
    strokeWidth?: number
    strokeStyle?: StrokeStyle
    strokeCap?: StrokeCap
    strokeJoin?: StrokeJoin
  },
): void {
  const fill = colors.fill ? colorStyle(colors.fill) : undefined
  const stroke = colors.stroke ? colorStyle(colors.stroke) : undefined
  const gradient = colors.fillGradient && colors.fillBounds
    ? fillGradient(context, colors.fillGradient, mapRect(colors.fillBounds, mapping))
    : undefined
  // The outline spans the same box as the fill, so it uses the same axis helper.
  const strokeRamp = colors.strokeGradient && colors.strokeBounds
    ? fillGradient(context, colors.strokeGradient, mapRect(colors.strokeBounds, mapping))
    : undefined
  if (fill) {
    tracePath(context, path, mapping)
    context.fillStyle = gradient ?? fill.style
    context.globalAlpha = gradient ? 1 : fill.alpha
    context.fill()
  }
  if (stroke) {
    tracePath(context, path, mapping)
    context.strokeStyle = strokeRamp ?? stroke.style
    context.globalAlpha = strokeRamp ? 1 : stroke.alpha
    // Same floor table borders use: at thumbnail scale a real width lands below one pixel.
    const width = colors.strokeWidth !== undefined ? Math.max(1, colors.strokeWidth * mapping.scale) : 1
    context.lineWidth = width
    // Always set: an unset cap or join keeps whatever the previous element left on the context.
    context.lineCap = canvasLineCap(colors.strokeCap)
    context.lineJoin = canvasLineJoin(colors.strokeJoin)
    context.setLineDash(dashPattern(colors.strokeStyle ?? 'solid', width))
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
    const bounds = mapRect(node.bounds, mapping)

    withFlipAndRotation(context, bounds, node.transform, () => {
      createPath(context, node, mapping)
      if (fill) {
        createPath(context, node, mapping)
        // The gradient already carries per-stop alpha, so globalAlpha stays open for it.
        context.fillStyle = node.resolvedFillGradient
          ? fillGradient(context, node.resolvedFillGradient, bounds)
          : fill.style
        context.globalAlpha = node.resolvedFillGradient ? 1 : fill.alpha
        context.fill()
      }
      if (stroke) {
        createPath(context, node, mapping)
        context.strokeStyle = node.resolvedStrokeGradient
          ? fillGradient(context, node.resolvedStrokeGradient, bounds)
          : stroke.style
        context.globalAlpha = node.resolvedStrokeGradient ? 1 : stroke.alpha
        const width = node.strokeWidth !== undefined ? Math.max(1, node.strokeWidth * mapping.scale) : 1
        context.lineWidth = width
        context.lineCap = canvasLineCap(node.strokeCap)
        context.lineJoin = canvasLineJoin(node.strokeJoin)
        context.setLineDash(dashPattern(node.strokeStyle ?? 'solid', width))
        context.stroke()
      }
    })
  } finally {
    context.restore()
  }
}

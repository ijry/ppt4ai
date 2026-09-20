import type { PathCommand } from '@ppt4ai/geometry'
import { gradientAxis, gradientFocus, patternCoverage, patternGeometry, rotationRadians } from '@ppt4ai/geometry'
import type { DashSegment, Rect, ResolvedColor, ResolvedGradient, ResolvedPattern, ResolvedShadow, StrokeCap, StrokeJoin, StrokeStyle } from '@ppt4ai/model'
import type { SceneShapeNode, ScenePictureFill } from '@ppt4ai/render'
import type { DecodedImage } from './image-canvas-renderer'
import { applyEffects, cropSource } from './image-painting'
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
 * The existing pctNN fill approximation: foreground at coverage * alpha over the background.
 * Collapse those two source-over layers to one stroke so edges, dashes and shadows are drawn once.
 * This is a smooth color approximation, not a dither or a texture clipped to the shape interior.
 */
function percentagePatternStroke(pattern: ResolvedPattern | undefined): { style: string; alpha: number } | undefined {
  if (!pattern) return undefined
  const coverage = patternCoverage(pattern.preset)
  if (coverage === undefined) return undefined
  const foreground = colorStyle(pattern.foreground)
  const background = colorStyle(pattern.background)
  // Keep weights in the model's 100000-based units to avoid pct90's 25.5 becoming 25.499999... .
  const foregroundWeight = pattern.foreground.alpha * coverage
  const backgroundWeight = pattern.background.alpha * (100000 - foregroundWeight) / 100000
  const total = foregroundWeight + backgroundWeight
  if (total === 0) return { style: '#000000', alpha: 0 }
  const rgb = [1, 3, 5].map((offset) => {
    const front = Number.parseInt(foreground.style.slice(offset, offset + 2), 16)
    const back = Number.parseInt(background.style.slice(offset, offset + 2), 16)
    return Math.round((front * foregroundWeight + back * backgroundWeight) / total).toString(16).padStart(2, '0')
  }).join('').toUpperCase()
  return { style: '#' + rgb, alpha: total / 100000 }
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

/**
 * `a:miter/@lim` is a percentage of the line width (100000 is 100%); canvas's `miterLimit` is the ratio
 * of miter length to line width. Same reference length, so the conversion is the percentage itself.
 *
 * Canvas's default is 10, which is `lim="1000000"` — that is what an absent limit returns, so a shape
 * that says nothing keeps the behaviour it had. Whether both specs mean the full width rather than half
 * of it is not verifiable here; if a reader shows otherwise this constant is the only thing to change.
 */
export function canvasMiterLimit(limit: number | undefined): number {
  return limit !== undefined && limit > 0 ? limit / 100000 : 10
}

/**
 * Canvas dash pattern for a stroke style, in the same units as the line width so a thick dash keeps
 * its proportions. Exported because table borders paint the same styles and had their own copy.
 *
 * The eleven OOXML tokens collapse into four structures here, not in the model: ECMA-376's exact
 * lengths are not verifiable in this environment, so `lg` (longer dashes) and `sys` (thinner system
 * variants) paint like their base word rather than inventing magnitudes for them. The dash-dot
 * families do get their own pattern — appending the existing dot to the existing dash needs no new
 * number, and before this they painted identically to a plain dash.
 */
export function dashPattern(style: StrokeStyle | { custom: DashSegment[] }, width: number): number[] {
  // `a:custDash` states its own lengths, so there is nothing to approximate: each `a:ds` is a percentage
  // of the line width. A zero-width line yields an all-zero array, which canvas treats as solid.
  if (typeof style === 'object') {
    if (width <= 0) return []
    return style.custom.flatMap((segment) => [segment.dash * width / 100000, segment.space * width / 100000])
  }
  const dash = [4 * width, 3 * width]
  const dot = [width, 2 * width]
  switch (style) {
    case 'dot':
    case 'sysDot':
      return dot
    case 'dash':
    case 'lgDash':
    case 'sysDash':
      return dash
    case 'dashDot':
    case 'lgDashDot':
    case 'sysDashDot':
      return [...dash, ...dot]
    case 'lgDashDotDot':
    case 'sysDashDotDot':
      return [...dash, ...dot, ...dot]
    default:
      return []
  }
}

/**
 * `dist` and `dir` become canvas offsets exactly — `dir` carries `a:lin/@ang`'s unit, which the
 * geometry package already converts. `blurRad` is handed to `shadowBlur` unchanged: canvas defines
 * that as a Gaussian with σ = half the value, and its relation to OOXML's radius is not verifiable
 * here, so this is a documented approximation rather than a conversion.
 */
function applyShadow(context: ShapeContext, shadow: ResolvedShadow, scale: number): void {
  const { style, alpha } = colorStyle(shadow.color)
  const red = Number.parseInt(style.slice(1, 3), 16)
  const green = Number.parseInt(style.slice(3, 5), 16)
  const blue = Number.parseInt(style.slice(5, 7), 16)
  const angle = rotationRadians(shadow.direction ?? 0)
  const distance = (shadow.distance ?? 0) * scale
  context.shadowColor = `rgba(${red}, ${green}, ${blue}, ${alpha})`
  context.shadowBlur = (shadow.blurRadius ?? 0) * scale
  context.shadowOffsetX = Math.cos(angle) * distance
  context.shadowOffsetY = Math.sin(angle) * distance
}

/** Set unconditionally for the same reason `lineCap` is: an unset shadow keeps the previous one. */
export function clearShadow(context: ShapeContext): void {
  context.shadowColor = 'rgba(0, 0, 0, 0)'
  context.shadowBlur = 0
  context.shadowOffsetX = 0
  context.shadowOffsetY = 0
}

/**
 * A shape casts one shadow, not one per paint operation: filling and stroking would each cast their
 * own, and the stroke's would show through a translucent fill. The first operation that paints gets
 * the shadow and every later one gets it cleared.
 */
function shadowCaster(context: ShapeContext, shadow: ResolvedShadow | undefined, scale: number): () => void {
  let pending = shadow !== undefined
  return () => {
    if (shadow && pending) {
      applyShadow(context, shadow, scale)
      pending = false
      return
    }
    clearShadow(context)
  }
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
 * A canvas gradient across the mapped box: an `a:path` gradient is a circle centred on the rect it
 * converges to, anything else is the axis `gradientAxis` computes. Stop positions are thousandths of a
 * percent in the model and a 0..1 offset on the canvas, and they are clamped because `addColorStop`
 * throws outside that range while the model only bounds each stop on its own.
 *
 * Alpha rides on the stop colour rather than `globalAlpha`, since stops can differ in transparency.
 */
export function fillGradient(context: ShapeContext, gradient: ResolvedGradient, bounds: Rect): CanvasGradient {
  const canvasGradient = gradient.path
    ? radialGradient(context, gradient, bounds)
    : linearGradient(context, gradient, bounds)
  for (const stop of gradient.stops) {
    const { style, alpha } = colorStyle(stop.color)
    const offset = Math.min(1, Math.max(0, stop.pos / 100000))
    canvasGradient.addColorStop(offset, alpha >= 1 ? style : rgbaStyle(style, alpha))
  }
  return canvasGradient
}

function linearGradient(context: ShapeContext, gradient: ResolvedGradient, bounds: Rect): CanvasGradient {
  const axis = gradientAxis(bounds, gradient.angle ?? 0, gradient.scaled ?? false)
  return context.createLinearGradient(axis.from.x, axis.from.y, axis.to.x, axis.to.y)
}

/** All three `a:path` words paint as a circle: canvas has no rect or shape gradient to offer. */
function radialGradient(context: ShapeContext, gradient: ResolvedGradient, bounds: Rect): CanvasGradient {
  const focus = gradientFocus(bounds, gradient.fillToRect)
  return context.createRadialGradient(focus.centre.x, focus.centre.y, 0, focus.centre.x, focus.centre.y, focus.radius)
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
    } else if (command.type === 'cubic') {
      context.bezierCurveTo(mapX(command.x1), mapY(command.y1), mapX(command.x2), mapY(command.y2), mapX(command.x), mapY(command.y))
    } else if (command.type === 'quad') {
      context.quadraticCurveTo(mapX(command.x1), mapY(command.y1), mapX(command.x), mapY(command.y))
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
    /** Needed for a gradient axis and for a picture's target box: both span the mapped box, not the path. */
    fillBounds?: Rect
    pictureFill?: ScenePictureFill
    /** The decoded media for `pictureFill`; absent means it could not be loaded, so no fill paints. */
    picture?: DecodedImage
    /** An `a:pattFill` with both colours resolved; needs `fillBounds` for the same reason a gradient does. */
    fillPattern?: ResolvedPattern
    shadow?: ResolvedShadow
    stroke?: ResolvedColor
    strokeGradient?: ResolvedGradient
    strokePattern?: ResolvedPattern
    strokeBounds?: Rect
    strokeWidth?: number
    strokeStyle?: StrokeStyle | { custom: DashSegment[] }
    strokeCap?: StrokeCap
    strokeJoin?: StrokeJoin
    strokeMiterLimit?: number
  },
): void {
  const fill = colors.fill ? colorStyle(colors.fill) : undefined
  const stroke = percentagePatternStroke(colors.strokePattern) ?? (colors.stroke ? colorStyle(colors.stroke) : undefined)
  const gradient = colors.fillGradient && colors.fillBounds
    ? fillGradient(context, colors.fillGradient, mapRect(colors.fillBounds, mapping))
    : undefined
  // The outline spans the same box as the fill, so it uses the same axis helper.
  const strokeRamp = colors.strokeGradient && colors.strokeBounds
    ? fillGradient(context, colors.strokeGradient, mapRect(colors.strokeBounds, mapping))
    : undefined
  const castShadow = shadowCaster(context, colors.shadow, mapping.scale)
  if (fill) {
    // A pattern paints its own background and lines; a preset with no geometry falls through to the
    // flat colour below, exactly as in paintShapeNode.
    let painted = false
    if (colors.fillPattern && colors.fillBounds) {
      castShadow()
      painted = paintPatternFill(context, colors.fillPattern, path, mapping, mapRect(colors.fillBounds, mapping))
    }
    if (!painted) {
      tracePath(context, path, mapping)
      context.fillStyle = gradient ?? fill.style
      context.globalAlpha = gradient ? 1 : fill.alpha
      castShadow()
      context.fill()
    }
  }
  if (colors.pictureFill && colors.picture && colors.fillBounds) {
    castShadow()
    paintPictureFill(context, path, mapping, mapRect(colors.fillBounds, mapping), colors.pictureFill, colors.picture)
  }
  if (stroke) {
    castShadow()
    tracePath(context, path, mapping)
    context.strokeStyle = strokeRamp ?? stroke.style
    context.globalAlpha = strokeRamp ? 1 : stroke.alpha
    // Same floor table borders use: at thumbnail scale a real width lands below one pixel.
    const width = colors.strokeWidth !== undefined ? Math.max(1, colors.strokeWidth * mapping.scale) : 1
    context.lineWidth = width
    // Always set: an unset cap or join keeps whatever the previous element left on the context.
    context.lineCap = canvasLineCap(colors.strokeCap)
    context.lineJoin = canvasLineJoin(colors.strokeJoin)
    context.miterLimit = canvasMiterLimit(colors.strokeMiterLimit)
    context.setLineDash(dashPattern(colors.strokeStyle ?? 'solid', width))
    context.stroke()
  }
  // This function has no save/restore of its own, and text is drawn right after it: leaving the
  // shadow set would put one behind every glyph.
  clearShadow(context)
}

/**
 * The picture stretched across the shape's box and clipped to its path. Canvas has no "fill a path
 * with an image" call, so the clip is what makes a rounded rectangle or an ellipse crop the photo
 * instead of showing its corners. `bounds` is already mapped, like everything else drawn here.
 *
 * The clip is undone before returning, or the stroke drawn next would be clipped to half its width.
 */
const EMU_PER_PIXEL = 9525

/**
 * `a:tile`. The tile is the source at its natural size — pixels at 96 dpi, hence `EMU_PER_PIXEL` — scaled
 * by `sx`/`sy`, offset by `tx`/`ty` and anchored to the corner `algn` names. `createPattern` repeats it
 * and the matrix carries all of that, so nothing here is invented.
 *
 * `@flip` is not painted: mirroring alternate tiles needs a pre-composed 2×2 tile, which a repeat
 * pattern cannot express. The word stays in the model and in the file.
 */
function tileMatrix(tile: NonNullable<ScenePictureFill['tile']>, bounds: Rect, image: DecodedImage, scale: number): DOMMatrix2DInit {
  const scaleX = (tile.scaleX ?? 100000) / 100000
  const scaleY = (tile.scaleY ?? 100000) / 100000
  const width = image.width * EMU_PER_PIXEL * scale * scaleX
  const height = image.height * EMU_PER_PIXEL * scale * scaleY
  // Written as explicit sets rather than prefix tests, because `ctr` ends in `r` without meaning right.
  const align = tile.align ?? 'tl'
  const right = align === 'r' || align === 'tr' || align === 'br'
  const bottom = align === 'b' || align === 'bl' || align === 'br'
  const centreX = align === 'ctr' || align === 't' || align === 'b'
  const centreY = align === 'ctr' || align === 'l' || align === 'r'
  const anchorX = bounds.x + (right ? bounds.w - width : centreX ? (bounds.w - width) / 2 : 0)
  const anchorY = bounds.y + (bottom ? bounds.h - height : centreY ? (bounds.h - height) / 2 : 0)
  // The init dictionary rather than a `DOMMatrix`: `setTransform` accepts it, and it needs no DOM.
  return {
    a: width / image.width,
    d: height / image.height,
    e: anchorX + (tile.offsetX ?? 0) * scale,
    f: anchorY + (tile.offsetY ?? 0) * scale,
  }
}

/**
 * `a:fillRect`'s target box: each side inset by its percentage of the shape box, negatives pushing the
 * picture outside the frame. A box with no width or height left describes nothing paintable, so the
 * caller skips the draw rather than filling a reversed rectangle.
 */
function stretchedBounds(bounds: Rect, stretch: NonNullable<ScenePictureFill['stretch']>): Rect | undefined {
  const left = (stretch.left ?? 0) / 100000
  const top = (stretch.top ?? 0) / 100000
  const right = (stretch.right ?? 0) / 100000
  const bottom = (stretch.bottom ?? 0) / 100000
  const w = bounds.w * (1 - left - right)
  const h = bounds.h * (1 - top - bottom)
  if (w <= 0 || h <= 0) return undefined
  return { x: bounds.x + bounds.w * left, y: bounds.y + bounds.h * top, w, h }
}

export function paintPictureFill(
  context: ShapeContext,
  path: readonly PathCommand[],
  mapping: ShapePageMapping,
  bounds: Rect,
  fill: ScenePictureFill,
  image: DecodedImage,
): void {
  context.save()
  try {
    context.globalAlpha = 1
    applyEffects(context, fill.effects)
    if (fill.tile) {
      const pattern = context.createPattern(image.source, 'repeat')
      if (!pattern) return
      pattern.setTransform(tileMatrix(fill.tile, bounds, image, mapping.scale))
      tracePath(context, path, mapping)
      context.fillStyle = pattern
      context.fill()
      return
    }
    const target = fill.stretch ? stretchedBounds(bounds, fill.stretch) : bounds
    if (!target) return
    tracePath(context, path, mapping)
    context.clip()
    const source = cropSource(image, fill.sourceCrop)
    if (source) context.drawImage(image.source, ...source, target.x, target.y, target.w, target.h)
    else context.drawImage(image.source, target.x, target.y, target.w, target.h)
  } finally {
    context.restore()
  }
}

function createPath(context: ShapeContext, node: SceneShapeNode, mapping: ShapePageMapping): void {
  tracePath(context, node.path, mapping)
}

/**
 * An `a:pattFill` drawn over its own background colour, clipped to the shape's path. Two forms:
 *
 * A line-shaped preset strokes a set of foreground lines. A `pctNN` preset fills the foreground at that
 * coverage instead, because the dither Office draws would be thousands of dots on a full-page shape
 * while the blend costs one `fillRect` and matches the average colour at any zoom.
 *
 * Returns false for a preset that is neither, and the caller then paints the flat foreground colour it
 * painted before any pattern had geometry.
 *
 * Lines are drawn rather than tiled through `createPattern` so the same code runs in the worker and in
 * the tests, neither of which has a canvas to rasterize a tile into.
 */
export function paintPatternFill(
  context: ShapeContext,
  pattern: ResolvedPattern,
  path: readonly PathCommand[],
  mapping: ShapePageMapping,
  bounds: Rect,
): boolean {
  if (!(bounds.w > 0) || !(bounds.h > 0)) return false
  const geometry = patternGeometry(pattern.preset, bounds)
  const coverage = geometry ? undefined : patternCoverage(pattern.preset)
  if (!geometry && coverage === undefined) return false
  const background = colorStyle(pattern.background)
  const foreground = colorStyle(pattern.foreground)
  context.save()
  try {
    tracePath(context, path, mapping)
    context.clip()
    context.globalAlpha = background.alpha
    context.fillStyle = background.style
    context.fillRect(bounds.x, bounds.y, bounds.w, bounds.h)
    // One shadow per shape, as everywhere else: the background has just cast it, so the rest must not.
    clearShadow(context)
    if (geometry) {
      context.globalAlpha = foreground.alpha
      context.strokeStyle = foreground.style
      context.lineWidth = geometry.lineWidth
      context.setLineDash([])
      context.beginPath()
      for (const line of geometry.lines) {
        context.moveTo(line.from.x, line.from.y)
        context.lineTo(line.to.x, line.to.y)
      }
      context.stroke()
    } else {
      // The word's own percentage, scaled by whatever transparency the foreground colour itself carries.
      context.globalAlpha = foreground.alpha * (coverage ?? 1)
      context.fillStyle = foreground.style
      context.fillRect(bounds.x, bounds.y, bounds.w, bounds.h)
    }
  } finally {
    context.restore()
  }
  return true
}

/**
 * `picture` is the decoded media for `node.pictureFill`. The caller loads it, because loading is
 * asynchronous and painting is not; absent means it failed or was never asked for, and then the shape
 * paints its outline and nothing else rather than disappearing.
 */
export function paintShapeNode(context: ShapeContext, node: SceneShapeNode, mapping: ShapePageMapping, picture?: DecodedImage): void {
  context.save()
  try {
    validateMapping(mapping)
    const fill = node.resolvedFillColor ? colorStyle(node.resolvedFillColor) : undefined
    const stroke = percentagePatternStroke(node.resolvedStrokePattern) ?? (node.resolvedStrokeColor ? colorStyle(node.resolvedStrokeColor) : undefined)
    const bounds = mapRect(node.bounds, mapping)

    withFlipAndRotation(context, bounds, node.transform, () => {
      const castShadow = shadowCaster(context, node.shadow, mapping.scale)
      createPath(context, node, mapping)
      if (fill) {
        // A pattern paints its own background and lines. Only when its preset has no geometry does the
        // flat foreground colour stand in for it, which is what every pattern painted before this.
        let painted = false
        if (node.resolvedFillPattern) {
          castShadow()
          painted = paintPatternFill(context, node.resolvedFillPattern, node.path, mapping, bounds)
        }
        if (!painted) {
          createPath(context, node, mapping)
          // The gradient already carries per-stop alpha, so globalAlpha stays open for it.
          context.fillStyle = node.resolvedFillGradient
            ? fillGradient(context, node.resolvedFillGradient, bounds)
            : fill.style
          context.globalAlpha = node.resolvedFillGradient ? 1 : fill.alpha
          castShadow()
          context.fill()
        }
      }
      if (node.pictureFill && picture) {
        castShadow()
        paintPictureFill(context, node.path, mapping, bounds, node.pictureFill, picture)
      }
      if (stroke) {
        createPath(context, node, mapping)
        castShadow()
        context.strokeStyle = node.resolvedStrokeGradient
          ? fillGradient(context, node.resolvedStrokeGradient, bounds)
          : stroke.style
        context.globalAlpha = node.resolvedStrokeGradient ? 1 : stroke.alpha
        const width = node.strokeWidth !== undefined ? Math.max(1, node.strokeWidth * mapping.scale) : 1
        context.lineWidth = width
        context.lineCap = canvasLineCap(node.strokeCap)
        context.lineJoin = canvasLineJoin(node.strokeJoin)
        context.miterLimit = canvasMiterLimit(node.strokeMiterLimit)
        context.setLineDash(dashPattern(node.strokeStyle ?? 'solid', width))
        context.stroke()
      }
    })
  } finally {
    context.restore()
  }
}

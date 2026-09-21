import type { ResolvedColor, TextMarks } from '@ppt4ai/model'
import type { SceneTextLayout, SceneTextLayoutLine, SceneTextLayoutMarker, SceneTextLayoutRun, SceneTextNode } from '@ppt4ai/render'
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from '@ppt4ai/text'
import type { DecodedImage } from './image-canvas-renderer'
import { withRotation } from './rotation-transform'
import { fillGradient, paintPathFills, percentagePatternStroke } from './shape-painting'

export interface TextPageMapping {
  scale: number
  offsetX: number
  offsetY: number
}

type TextContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type TextItem = SceneTextLayoutRun | SceneTextLayoutMarker

interface TextPaintStyle {
  color: string
  alpha: number
  font: string
  fontPixels: number
}

const EMU_PER_POINT = 12700
const DEFAULT_FONT_SCALE = 100000

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`)
  return value
}

function validateMapping(mapping: TextPageMapping): void {
  finite(mapping.scale, 'text mapping scale')
  if (mapping.scale <= 0) throw new Error('text mapping scale must be positive')
  finite(mapping.offsetX, 'text mapping offsetX')
  finite(mapping.offsetY, 'text mapping offsetY')
}

function colorState(color: ResolvedColor | undefined): { color: string; alpha: number } {
  if (!color) return { color: '#000000', alpha: 1 }
  if (!/^[0-9A-Fa-f]{6}$/.test(color.rgb)) throw new Error('text color must be six hexadecimal digits')
  if (!Number.isFinite(color.alpha) || color.alpha < 0 || color.alpha > 100000) {
    throw new Error('text alpha must be between 0 and 100000')
  }
  return { color: `#${color.rgb.toUpperCase()}`, alpha: color.alpha / 100000 }
}

/**
 * A family still carrying the `+` sigil is a theme reference the scene could not resolve — OOXML
 * reserves that prefix, so no installed font answers to it. Treat it as absent instead of handing
 * `18px "+mj-lt"` to the canvas.
 */
function fontState(marks: TextMarks | undefined, resolvedFontFamily: string | undefined, fontScale: number, pageScale: number): Pick<TextPaintStyle, 'font' | 'fontPixels'> {
  const fontSize = finite(marks?.fontSize ?? DEFAULT_FONT_SIZE, 'text font size')
  if (fontSize <= 0) throw new Error('text font size must be positive')
  const fontPixels = fontSize * EMU_PER_POINT * fontScale / DEFAULT_FONT_SCALE * pageScale
  const requested = resolvedFontFamily ?? marks?.fontFamily
  const family = JSON.stringify(requested && !requested.startsWith('+') ? requested : DEFAULT_FONT_FAMILY)
  const prefix = [marks?.italic ? 'italic' : '', marks?.bold ? 'bold' : ''].filter(Boolean).join(' ')
  return { fontPixels, font: `${prefix ? `${prefix} ` : ''}${fontPixels}px ${family}` }
}

function paintStyle(item: TextItem, fontScale: number, pageScale: number): TextPaintStyle {
  return {
    ...fontState(item.marks, item.resolvedFontFamily, fontScale, pageScale),
    ...colorState('resolvedColor' in item ? item.resolvedColor : undefined),
  }
}

function validateDimension(value: number, name: string): number {
  finite(value, name)
  if (value < 0) throw new Error(`${name} must be non-negative`)
  return value
}

function validateLine(line: SceneTextLayoutLine): void {
  finite(line.x, 'text line x')
  finite(line.y, 'text line y')
  validateDimension(line.width, 'text line width')
  validateDimension(line.height, 'text line height')
}

function validateHorizontalItem(item: TextItem, name: string): void {
  finite(item.x, `${name} x`)
  validateDimension(item.width, `${name} width`)
}

function validateVerticalItem(item: TextItem, name: string): void {
  finite(item.x, `${name} x`)
  finite(item.y ?? Number.NaN, `${name} y`)
  validateDimension(item.width, `${name} width`)
  validateDimension(item.height ?? Number.NaN, `${name} height`)
  if (item.orientation !== 'upright' && item.orientation !== 'rotated') {
    throw new Error('text orientation must be upright or rotated')
  }
}

function applyTextStyle(context: TextContext, style: TextPaintStyle): void {
  context.font = style.font
  context.textAlign = 'left'
  context.textBaseline = 'top'
  context.fillStyle = style.color
  context.globalAlpha = style.alpha
}

/**
 * `a:rPr/@u`'s word decides whether there is a line and what structure it has. The dotted and dashed
 * families reuse the dash lengths the outline painter already ships, so no new magnitudes appear here;
 * `dbl`, `heavy`, `wavy` and `words` draw the one solid line they drew before the word was preserved,
 * because a second line's spacing, a heavier weight and a wave's amplitude would all be invented.
 */
function underlinePattern(underline: string | undefined, fontPixels: number): { dash: number[] } | undefined {
  if (underline === undefined || underline === 'none') return undefined
  const width = Math.max(1, fontPixels * 0.05)
  if (underline.startsWith('dotted')) return { dash: [width, 2 * width] }
  if (underline.startsWith('dash') || underline.startsWith('dotDash') || underline.startsWith('dotDotDash')) {
    return { dash: [4 * width, 3 * width] }
  }
  return { dash: [] }
}

function paintHorizontalItem(
  context: TextContext,
  item: TextItem,
  line: SceneTextLayoutLine,
  style: TextPaintStyle,
  mapping: TextPageMapping,
): void {
  if (item.text.length === 0) return
  const highlight = 'resolvedHighlight' in item ? item.resolvedHighlight : undefined
  if (highlight) {
    // The swatch spans the run's advance over the line box, painted before the glyphs sit on top of it.
    const swatch = colorState(highlight)
    context.fillStyle = swatch.color
    context.globalAlpha = swatch.alpha
    context.fillRect(
      mapping.offsetX + item.x * mapping.scale,
      mapping.offsetY + line.y * mapping.scale,
      item.width * mapping.scale,
      line.height * mapping.scale,
    )
    context.globalAlpha = 1
  }
  applyTextStyle(context, style)
  const x = mapping.offsetX + item.x * mapping.scale
  const y = mapping.offsetY + line.y * mapping.scale
  // A gradient run fill paints the glyphs with a CanvasGradient over the mapped run box; the flat colour
  // (the first stop) stays set for a run that resolves none, exactly as the shape painter does.
  // A pattern run fill has no tiled form on a glyph, so a percentage preset paints as its composite
  // colour (foreground over background at its coverage); a line preset keeps the flat foreground.
  const runPattern = 'resolvedFillPattern' in item ? item.resolvedFillPattern : undefined
  const patternComposite = percentagePatternStroke(runPattern)
  if (patternComposite) {
    context.fillStyle = patternComposite.style
    context.globalAlpha = patternComposite.alpha
  }
  const runGradient = 'resolvedFillGradient' in item ? item.resolvedFillGradient : undefined
  if (runGradient) {
    context.fillStyle = fillGradient(context, runGradient, { x, y, w: item.width * mapping.scale, h: line.height * mapping.scale })
    context.globalAlpha = 1
  }
  context.fillText(item.text, x, y)
  const underline = underlinePattern(item.marks?.underline, style.fontPixels)
  if (!underline) return
  context.beginPath()
  context.moveTo(x, mapping.offsetY + (line.y + line.height * 0.9) * mapping.scale)
  context.lineTo(mapping.offsetX + (item.x + item.width) * mapping.scale, mapping.offsetY + (line.y + line.height * 0.9) * mapping.scale)
  context.strokeStyle = style.color
  context.globalAlpha = style.alpha
  context.lineWidth = Math.max(1, style.fontPixels * 0.05)
  context.setLineDash(underline.dash)
  context.stroke()
  context.setLineDash([])
}

function paintVerticalItem(
  context: TextContext,
  item: TextItem,
  style: TextPaintStyle,
  mapping: TextPageMapping,
): void {
  if (item.text.length === 0) return
  const x = mapping.offsetX + item.x * mapping.scale
  const y = mapping.offsetY + item.y! * mapping.scale
  if (item.orientation === 'upright') {
    applyTextStyle(context, style)
    // An upright vertical glyph sits in an unrotated box, so a gradient fills it the same way a
    // horizontal run does. Rotated glyphs draw under a transform and stay flat (documented limit).
    const upGradient = 'resolvedFillGradient' in item ? item.resolvedFillGradient : undefined
    if (upGradient) {
      context.fillStyle = fillGradient(context, upGradient, { x, y, w: item.width * mapping.scale, h: item.height! * mapping.scale })
      context.globalAlpha = 1
    }
    context.fillText(item.text, x, y)
    return
  }
  context.save()
  try {
    context.translate(mapping.offsetX + (item.x + item.width) * mapping.scale, y)
    context.rotate(Math.PI / 2)
    applyTextStyle(context, style)
    // The glyph draws in the rotated local frame, so a page-space gradient axis is mapped into it:
    // a page direction (a, b) becomes local (b, -a) — the angle turns by -90deg and the box dims swap.
    const rotatedGradient = 'resolvedFillGradient' in item ? item.resolvedFillGradient : undefined
    if (rotatedGradient) {
      const localAngle = ((((rotatedGradient.angle ?? 0) - 5400000) % 21600000) + 21600000) % 21600000
      context.fillStyle = fillGradient(context, { ...rotatedGradient, angle: localAngle }, { x: 0, y: 0, w: item.height! * mapping.scale, h: item.width * mapping.scale })
      context.globalAlpha = 1
    }
    context.fillText(item.text, 0, 0)
  } finally {
    context.restore()
  }
}

export function paintTextLayout(context: TextContext, layout: SceneTextLayout, mapping: TextPageMapping): void {
  context.save()
  try {
    validateMapping(mapping)
    const fontScale = finite(layout.fontScale, 'text font scale')
    if (fontScale <= 0) throw new Error('text font scale must be positive')
    for (const line of layout.lines) {
      validateLine(line)
      if (line.marker) {
        if (layout.vertical === 'vertical') {
          validateVerticalItem(line.marker, 'text marker')
          paintVerticalItem(context, line.marker, paintStyle(line.marker, fontScale, mapping.scale), mapping)
        } else {
          validateHorizontalItem(line.marker, 'text marker')
          paintHorizontalItem(context, line.marker, line, paintStyle(line.marker, fontScale, mapping.scale), mapping)
        }
      }
      for (const run of line.runs) {
        if (layout.vertical === 'vertical') {
          validateVerticalItem(run, 'text run')
          paintVerticalItem(context, run, paintStyle(run, fontScale, mapping.scale), mapping)
        } else {
          validateHorizontalItem(run, 'text run')
          paintHorizontalItem(context, run, line, paintStyle(run, fontScale, mapping.scale), mapping)
        }
      }
    }
  } finally {
    context.restore()
  }
}

export function paintTextNode(context: TextContext, node: SceneTextNode, mapping: TextPageMapping, picture?: DecodedImage): void {
  const bounds = {
    x: mapping.offsetX + finite(node.bounds.x, 'text bounds x') * mapping.scale,
    y: mapping.offsetY + finite(node.bounds.y, 'text bounds y') * mapping.scale,
    w: finite(node.bounds.w, 'text bounds w') * mapping.scale,
    h: finite(node.bounds.h, 'text bounds h') * mapping.scale,
  }
  withRotation(context, bounds, node.transform, () => {
    // A shape that carries text paints its geometry first, in the same order paintShapeNode uses.
    if (node.path) {
      paintPathFills(context, node.path, mapping, {
        ...(node.resolvedFillColor ? { fill: node.resolvedFillColor } : {}),
        ...(node.resolvedFillGradient ? { fillGradient: node.resolvedFillGradient, fillBounds: node.bounds } : {}),
        ...(node.resolvedFillPattern ? { fillPattern: node.resolvedFillPattern, fillBounds: node.bounds } : {}),
        ...(node.pictureFill ? { pictureFill: node.pictureFill, fillBounds: node.bounds } : {}),
        ...(node.pictureFill && picture ? { picture } : {}),
        ...(node.resolvedStrokeColor ? { stroke: node.resolvedStrokeColor } : {}),
        ...(node.resolvedStrokeGradient ? { strokeGradient: node.resolvedStrokeGradient, strokeBounds: node.bounds } : {}),
        ...(node.resolvedStrokePattern ? { strokePattern: node.resolvedStrokePattern } : {}),
        ...(node.strokeWidth === undefined ? {} : { strokeWidth: node.strokeWidth }),
        ...(node.strokeStyle === undefined ? {} : { strokeStyle: node.strokeStyle }),
        ...(node.strokeCap === undefined ? {} : { strokeCap: node.strokeCap }),
        ...(node.strokeJoin === undefined ? {} : { strokeJoin: node.strokeJoin }),
        ...(node.strokeMiterLimit === undefined ? {} : { strokeMiterLimit: node.strokeMiterLimit }),
        ...(node.shadow ? { shadow: node.shadow } : {}),
      })
    }
    paintTextLayout(context, node.layout, mapping)
  })
}

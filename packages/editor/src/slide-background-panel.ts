import type { Color, Fill, ResolvedColor, ResolvedGradient, ResolvedPattern, SlideBackground } from '@ppt4ai/model'

/**
 * What the panel can say about the background it is looking at. `color` is the *resolved* colour — the
 * one on screen, which may come from the layout or the master — while `own` decides whether there is
 * anything on this slide to clear.
 */
export type SlideBackgroundKind = 'color' | 'gradient' | 'pattern' | 'styleRef' | 'none'

export interface SlideBackgroundPanelModel {
  readonly active: boolean
  readonly color: string
  readonly kind: SlideBackgroundKind
  /** The slide declares its own `p:bg`, so clearing it has something to remove. */
  readonly own: boolean
  /** Nothing on this slide: the colour shown came from the layout, the master, or nowhere. */
  readonly inherited: boolean
  /** Two-stop linear gradient editor state: the current (or default) start and end swatches. */
  readonly gradientStart: string
  readonly gradientEnd: string
  /** The gradient angle in whole degrees, 0..359, for a plain number input. */
  readonly gradientAngle: number
}

export type SlideBackgroundPanelEmit = {
  (event: 'set-color', color: Color): void
  (event: 'set-gradient', fill: Fill): void
  (event: 'clear'): void
}

const FALLBACK_COLOR = '#FFFFFF'

function hexFromResolved(color: ResolvedColor | undefined): string {
  return color ? `#${color.rgb.toUpperCase()}` : FALLBACK_COLOR
}

/**
 * A gradient and a `p:bgRef` are reported as what they are rather than as their first stop or their
 * placeholder colour: a swatch cannot express either, and claiming it can is the same lie the outline
 * dropdown used to tell about `lgDashDot`.
 */
function kindOf(
  background: SlideBackground | undefined,
  resolvedGradient: ResolvedGradient | undefined,
  resolvedPattern: ResolvedPattern | undefined,
): SlideBackgroundKind {
  if (background?.fill?.gradient || (background === undefined && resolvedGradient)) return 'gradient'
  if (background?.fill?.pattern || (background === undefined && resolvedPattern)) return 'pattern'
  if (background?.styleRef) return 'styleRef'
  if (background?.fill) return 'color'
  if (resolvedGradient) return 'gradient'
  return resolvedPattern ? 'pattern' : 'none'
}

const FALLBACK_GRADIENT_END = '#FFFFFF'

function hexFromStop(color: ResolvedColor | undefined, fallback: string): string {
  return color ? `#${color.rgb.toUpperCase()}` : fallback
}

export function slideBackgroundModel(
  background: SlideBackground | undefined,
  resolved: ResolvedColor | undefined,
  resolvedGradient?: ResolvedGradient,
  active = true,
  resolvedPattern?: ResolvedPattern,
): SlideBackgroundPanelModel {
  const own = background !== undefined
  const stops = resolvedGradient?.stops ?? []
  const flat = hexFromResolved(resolved)
  return {
    active,
    color: flat,
    kind: kindOf(background, resolvedGradient, resolvedPattern),
    own,
    inherited: !own,
    gradientStart: hexFromStop(stops[0]?.color, flat),
    gradientEnd: hexFromStop(stops[stops.length - 1]?.color, FALLBACK_GRADIENT_END),
    gradientAngle: Math.round(((resolvedGradient?.angle ?? 0) / 60000) % 360),
  }
}

/** Mirrors the paint toolbar: an input value that is not six hex digits is refused rather than guessed. */
export function backgroundColorFrom(value: string): Color | undefined {
  const normalized = value.replace(/^#/u, '').toUpperCase()
  return /^[0-9A-F]{6}$/u.test(normalized) ? { type: 'srgb', v: normalized } : undefined
}

/**
 * A two-stop linear gradient background from the panel's inputs. Refuses non-hex swatches the same way
 * `backgroundColorFrom` does, and clamps the angle to 0..359 degrees, converted to OOXML's 60000ths.
 */
export function backgroundGradientFrom(startHex: string, endHex: string, angleDegrees: number): Fill | undefined {
  const start = backgroundColorFrom(startHex)
  const end = backgroundColorFrom(endHex)
  if (!start || !end) return undefined
  if (!Number.isFinite(angleDegrees)) return undefined
  const angle = ((Math.round(angleDegrees) % 360) + 360) % 360
  return {
    color: start,
    gradient: { stops: [{ pos: 0, color: start }, { pos: 100000, color: end }], angle: angle * 60000 },
  }
}

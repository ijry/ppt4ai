import type { Color, ResolvedColor, ResolvedGradient, SlideBackground } from '@ppt4ai/model'

/**
 * What the panel can say about the background it is looking at. `color` is the *resolved* colour — the
 * one on screen, which may come from the layout or the master — while `own` decides whether there is
 * anything on this slide to clear.
 */
export type SlideBackgroundKind = 'color' | 'gradient' | 'styleRef' | 'none'

export interface SlideBackgroundPanelModel {
  readonly active: boolean
  readonly color: string
  readonly kind: SlideBackgroundKind
  /** The slide declares its own `p:bg`, so clearing it has something to remove. */
  readonly own: boolean
  /** Nothing on this slide: the colour shown came from the layout, the master, or nowhere. */
  readonly inherited: boolean
}

export type SlideBackgroundPanelEmit = {
  (event: 'set-color', color: Color): void
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
function kindOf(background: SlideBackground | undefined, resolvedGradient: ResolvedGradient | undefined): SlideBackgroundKind {
  if (background?.fill?.gradient || (background === undefined && resolvedGradient)) return 'gradient'
  if (background?.styleRef) return 'styleRef'
  if (background?.fill) return 'color'
  return resolvedGradient ? 'gradient' : 'none'
}

export function slideBackgroundModel(
  background: SlideBackground | undefined,
  resolved: ResolvedColor | undefined,
  resolvedGradient?: ResolvedGradient,
  active = true,
): SlideBackgroundPanelModel {
  const own = background !== undefined
  return {
    active,
    color: hexFromResolved(resolved),
    kind: kindOf(background, resolvedGradient),
    own,
    inherited: !own,
  }
}

/** Mirrors the paint toolbar: an input value that is not six hex digits is refused rather than guessed. */
export function backgroundColorFrom(value: string): Color | undefined {
  const normalized = value.replace(/^#/u, '').toUpperCase()
  return /^[0-9A-F]{6}$/u.test(normalized) ? { type: 'srgb', v: normalized } : undefined
}

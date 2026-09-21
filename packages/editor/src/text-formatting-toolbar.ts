import { PAINTED_PRESET_PATTERNS } from '@ppt4ai/model'
import type { Color, Fill } from '@ppt4ai/model'
import type { TextFormattingState, TextMarkName, TextMarksPatch } from '@ppt4ai/text'

export interface TextFormattingToolbarProps {
  readonly active: boolean
  readonly state: TextFormattingState
  readonly fontFamilies: readonly string[]
  /**
   * Typefaces offered for the east asian slot (`a:ea`). A CJK list is usually not the latin one, so the
   * host can give both; with only one given the same list serves both slots rather than the control
   * disappearing, which is what the default configuration would otherwise do.
   */
  readonly eaFontFamilies?: readonly string[]
  readonly fontSizes: readonly number[]
}

export type TextFormattingToolbarEmit = {
  (event: 'set-marks', patch: TextMarksPatch): void
  (event: 'toggle-mark', name: TextMarkName): void
  (event: 'set-alignment', align: 'left' | 'center' | 'right'): void
}

const FALLBACK = '#FFFFFF'

/** A six-hex colour from a `#rrggbb` input, or undefined when the value is not six hex digits. */
export function textColorFrom(value: string): Color | undefined {
  const normalized = value.replace(/^#/u, '').toUpperCase()
  return /^[0-9A-F]{6}$/u.test(normalized) ? { type: 'srgb', v: normalized } : undefined
}

function hex(color: Color | undefined, fallback = FALLBACK): string {
  return color?.type === 'srgb' ? `#${color.v.toUpperCase()}` : fallback
}

/** The preset words a run pattern fill may use — the ones the painter can actually draw. */
export const TEXT_FILL_PATTERN_PRESETS: readonly string[] = PAINTED_PRESET_PATTERNS

export interface TextFillEditorState {
  readonly solid: string
  readonly gradientStart: string
  readonly gradientEnd: string
  readonly gradientAngle: number
  readonly patternPreset: string
  readonly patternForeground: string
  readonly patternBackground: string
}

/** The current run fill split into the fields the three fill editors (solid, gradient, pattern) show. */
export function textFillEditorState(fill: Fill | undefined): TextFillEditorState {
  const flat = hex(fill?.color)
  const stops = fill?.gradient?.stops ?? []
  const pattern = fill?.pattern
  return {
    solid: flat,
    gradientStart: hex(stops[0]?.color, flat),
    gradientEnd: hex(stops[stops.length - 1]?.color, FALLBACK),
    gradientAngle: Math.round(((fill?.gradient?.angle ?? 0) / 60000) % 360),
    patternPreset: pattern?.preset ?? TEXT_FILL_PATTERN_PRESETS[0]!,
    patternForeground: hex(pattern?.foreground, flat),
    patternBackground: hex(pattern?.background, FALLBACK),
  }
}

/** A two-stop linear gradient run fill, or undefined for a bad swatch or non-finite angle. */
export function textGradientFrom(startHex: string, endHex: string, angleDegrees: number): Fill | undefined {
  const start = textColorFrom(startHex)
  const end = textColorFrom(endHex)
  if (!start || !end || !Number.isFinite(angleDegrees)) return undefined
  const angle = ((Math.round(angleDegrees) % 360) + 360) % 360
  return { color: start, gradient: { stops: [{ pos: 0, color: start }, { pos: 100000, color: end }], angle: angle * 60000 } }
}

/** A pattern run fill, or undefined for an unpainted preset or a bad swatch; `color` mirrors the foreground. */
export function textPatternFrom(preset: string, foregroundHex: string, backgroundHex: string): Fill | undefined {
  if (!TEXT_FILL_PATTERN_PRESETS.includes(preset)) return undefined
  const foreground = textColorFrom(foregroundHex)
  const background = textColorFrom(backgroundHex)
  if (!foreground || !background) return undefined
  return { color: foreground, pattern: { preset, foreground, background } }
}

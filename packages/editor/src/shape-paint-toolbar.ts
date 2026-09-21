import type { Fill, StrokeStyle } from '@ppt4ai/model'

/** `a:ln/@w` is EMU and one point is 12700 of them; the toolbar shows points. */
const EMU_PER_POINT = 12700

export const STROKE_STYLE_OPTIONS: readonly StrokeStyle[] = ['solid', 'dash', 'dot']

/**
 * The three the toolbar offers, plus whatever the element already carries when the source used one of
 * the other eight `a:prstDash` tokens. Without the extra entry a `<select>` bound to `lgDashDot` falls
 * back to its first option and reports the outline as Solid — a lie about the file. Picking one of the
 * three replaces it, and the extra entry disappears with it.
 */
export function strokeStyleOptions(current: StrokeStyle | undefined): readonly StrokeStyle[] {
  if (current === undefined || STROKE_STYLE_OPTIONS.includes(current)) return STROKE_STYLE_OPTIONS
  return [...STROKE_STYLE_OPTIONS, current]
}

export interface ShapePaintToolbarProps {
  readonly active: boolean
  /** The resolved fill as a `#RRGGBB` string, absent when the element carries no fill. */
  readonly fillColor?: string
  /** A gradient has no single colour, so the swatch says so rather than claiming the first stop. */
  readonly fillIsGradient: boolean
  /** The fill gradient's editor state (start/end swatch, angle) when the element carries one. */
  readonly fillGradientStart?: string
  readonly fillGradientEnd?: string
  readonly fillGradientAngle?: number
  readonly strokeColor?: string
  readonly strokeIsGradient: boolean
  /** Absent means the width is inherited from the theme line styles. */
  readonly strokeWidth?: number
  readonly strokeStyle?: StrokeStyle
}

export type ShapePaintToolbarEmit = {
  (event: 'set-fill', fill: Fill | null): void
  (event: 'set-stroke', stroke: Fill | null): void
  (event: 'set-stroke-width', width: number | null): void
  (event: 'set-stroke-style', style: StrokeStyle | null): void
}

/**
 * Rounds to a whole EMU, so a fractional point value cannot produce a non-integer the model rejects.
 * An empty string is nothing rather than zero: `Number('')` is `0`, which would otherwise turn a
 * cleared input into an explicit hairline.
 */
export function emuFromPoints(value: number | string): number | undefined {
  if (typeof value === 'string' && value.trim() === '') return undefined
  const points = typeof value === 'number' ? value : Number(value.trim())
  if (!Number.isFinite(points) || points < 0) return undefined
  return Math.round(points * EMU_PER_POINT)
}

export function pointsFromEmu(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined
  return value / EMU_PER_POINT
}

/** A two-stop linear gradient fill from the toolbar's inputs; refuses a bad swatch or non-finite angle. */
export function shapeGradientFrom(startHex: string, endHex: string, angleDegrees: number): Fill | undefined {
  const hex = (value: string): { type: 'srgb'; v: string } | undefined => {
    const normalized = value.replace(/^#/u, '').toUpperCase()
    return /^[0-9A-F]{6}$/u.test(normalized) ? { type: 'srgb', v: normalized } : undefined
  }
  const start = hex(startHex)
  const end = hex(endHex)
  if (!start || !end || !Number.isFinite(angleDegrees)) return undefined
  const angle = ((Math.round(angleDegrees) % 360) + 360) % 360
  return { color: start, gradient: { stops: [{ pos: 0, color: start }, { pos: 100000, color: end }], angle: angle * 60000 } }
}

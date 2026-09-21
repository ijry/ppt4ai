import { DEFAULT_THEME_COLORS, DEFAULT_THEME_FONTS, type Color, type ThemeColorSlot, type ThemeFonts, type ThemeFontScript, type ThemeFontSlot } from '@ppt4ai/model'

export type ThemeSlotGroup = 'neutral' | 'accent' | 'hyperlink'

export const THEME_SLOT_GROUPS: readonly { group: ThemeSlotGroup; slots: readonly ThemeColorSlot[] }[] = [
  { group: 'neutral', slots: ['dk1', 'lt1', 'dk2', 'lt2'] },
  { group: 'accent', slots: ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] },
  { group: 'hyperlink', slots: ['hlink', 'folHlink'] },
]

/** The fixed row order of the font section: one group per slot, the three scripts inside it. */
export const THEME_FONT_ROWS: readonly { slot: ThemeFontSlot; scripts: readonly ThemeFontScript[] }[] = [
  { slot: 'major', scripts: ['latin', 'ea', 'cs'] },
  { slot: 'minor', scripts: ['latin', 'ea', 'cs'] },
]

export interface ThemePanelSlotModel {
  readonly slot: ThemeColorSlot
  readonly group: ThemeSlotGroup
  readonly color: string
  readonly isDefault: boolean
  readonly inherited: boolean
}

export interface ThemePanelFontModel {
  readonly slot: ThemeFontSlot
  readonly script: ThemeFontScript
  readonly typeface: string
  readonly isDefault: boolean
  readonly inherited: boolean
}

export interface ThemePanelProps {
  readonly active: boolean
  readonly slots: readonly ThemePanelSlotModel[]
  readonly fonts: readonly ThemePanelFontModel[]
  readonly fontFamilies: readonly string[]
}

export type ThemePanelEmit = {
  (event: 'set-color', slot: ThemeColorSlot, color: Color): void
  (event: 'reset-color', slot: ThemeColorSlot): void
  (event: 'set-font', slot: ThemeFontSlot, script: ThemeFontScript, typeface: string): void
  (event: 'reset-font', slot: ThemeFontSlot, script: ThemeFontScript): void
}

/** Mirrors the colour side: an absent value is inherited from the source theme, `null` is an explicit reset. */
export function themeFontModels(fonts: ThemeFonts | undefined): ThemePanelFontModel[] {
  return THEME_FONT_ROWS.flatMap((row) => row.scripts.map((script) => {
    const value = fonts?.[row.slot]?.[script]
    return {
      slot: row.slot,
      script,
      typeface: value ?? DEFAULT_THEME_FONTS[row.slot][script],
      isDefault: value === null,
      inherited: value === undefined,
    }
  }))
}

export function themeSlotGroup(slot: ThemeColorSlot): ThemeSlotGroup {
  const found = THEME_SLOT_GROUPS.find((entry) => entry.slots.includes(slot))
  if (!found) throw new Error(`unsupported theme color slot: ${slot}`)
  return found.group
}

export function hexFromColor(color: Color, slot?: ThemeColorSlot): string {
  if (color.type === 'srgb' && /^[0-9a-fA-F]{6}$/.test(color.v)) return `#${color.v.toUpperCase()}`
  return `#${(slot ? DEFAULT_THEME_COLORS[slot] : DEFAULT_THEME_COLORS.dk1).v.toUpperCase()}`
}

export function colorFromHex(value: string): Color | undefined {
  const normalized = value.replace(/^#/, '').toUpperCase()
  return /^[0-9A-F]{6}$/.test(normalized) ? { type: 'srgb', v: normalized } : undefined
}

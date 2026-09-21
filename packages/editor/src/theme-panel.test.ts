import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME_COLORS, DEFAULT_THEME_FONTS, type ThemeColorSlot } from '@ppt4ai/model'
import { colorFromHex, hexFromColor, THEME_FONT_ROWS, THEME_SLOT_GROUPS, themeFontModels, themeSlotGroup } from './theme-panel'

describe('theme panel metadata', () => {
  it('covers all twelve slots exactly once across groups', () => {
    const slots = THEME_SLOT_GROUPS.flatMap((group) => [...group.slots])

    expect(slots).toHaveLength(12)
    expect(new Set(slots).size).toBe(12)
    expect(Object.keys(DEFAULT_THEME_COLORS).every((slot) => slots.includes(slot as ThemeColorSlot))).toBe(true)
  })

  it('groups slots by neutral, accent, and hyperlink', () => {
    expect(themeSlotGroup('dk1')).toBe('neutral')
    expect(themeSlotGroup('accent3')).toBe('accent')
    expect(themeSlotGroup('folHlink')).toBe('hyperlink')
  })

  it('rejects an unsupported slot', () => {
    expect(() => themeSlotGroup('nope' as ThemeColorSlot)).toThrow(/unsupported theme color slot: nope/)
  })
})

describe('theme panel color conversion', () => {
  it('renders srgb colors as uppercase hex input values', () => {
    expect(hexFromColor({ type: 'srgb', v: 'ff0000' })).toBe('#FF0000')
  })

  it('falls back to the slot default for colors without a direct hex value', () => {
    expect(hexFromColor({ type: 'scheme', v: 'accent1' }, 'accent2')).toBe(`#${DEFAULT_THEME_COLORS.accent2.v}`)
  })

  it('parses hex input into srgb colors and rejects malformed input', () => {
    expect(colorFromHex('#00ff00')).toEqual({ type: 'srgb', v: '00FF00' })
    expect(colorFromHex('nope')).toBeUndefined()
    expect(colorFromHex('#FFF')).toBeUndefined()
  })
})

describe('theme panel font models', () => {
  it('covers both slots and all three scripts in a fixed order', () => {
    const rows = themeFontModels(undefined)

    expect(THEME_FONT_ROWS.flatMap((row) => [...row.scripts])).toHaveLength(6)
    expect(rows.map((row) => `${row.slot}-${row.script}`)).toEqual([
      'major-latin', 'major-ea', 'major-cs', 'minor-latin', 'minor-ea', 'minor-cs',
    ])
  })

  it('marks explicit, reset, and inherited typefaces', () => {
    const rows = themeFontModels({ major: { latin: 'Cambria', ea: null }, minor: {} })
    const byRow = new Map(rows.map((row) => [`${row.slot}-${row.script}`, row]))

    expect(byRow.get('major-latin')).toMatchObject({ typeface: 'Cambria', isDefault: false, inherited: false })
    expect(byRow.get('major-ea')).toMatchObject({ typeface: DEFAULT_THEME_FONTS.major.ea, isDefault: true, inherited: false })
    expect(byRow.get('minor-latin')).toMatchObject({ typeface: DEFAULT_THEME_FONTS.minor.latin, isDefault: false, inherited: true })
  })
})

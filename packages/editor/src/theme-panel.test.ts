import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME_COLORS, type ThemeColorSlot } from '@ppt4ai/model'
import { colorFromHex, hexFromColor, THEME_SLOT_GROUPS, themeSlotGroup } from './theme-panel'

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

import { describe, expect, it } from 'vitest'
import { resolveStyleFontColor, resolveStyleFontFamily, type Theme } from './index'

const theme: Theme = {
  id: 'theme-1',
  colors: { lt1: { type: 'srgb', v: 'FFFFFF' }, accent1: { type: 'srgb', v: '4472C4' } },
  fonts: { major: { latin: 'Cambria' }, minor: { latin: 'Calibri' } },
}

describe('style matrix font colour', () => {
  /** The colour sits on the reference itself; there is no `fmtScheme` list to look it up in. */
  it('resolves the reference colour', () => {
    expect(resolveStyleFontColor({ idx: 'minor', color: { type: 'scheme', v: 'lt1' } }, theme))
      .toEqual({ rgb: 'FFFFFF', alpha: 100000 })
  })

  it('resolves a colour carrying transforms', () => {
    const resolved = resolveStyleFontColor(
      { idx: 'minor', color: { type: 'scheme', v: 'accent1', transforms: [{ type: 'alpha', value: 50000 }] } },
      theme,
    )

    expect(resolved).toEqual({ rgb: '4472C4', alpha: 50000 })
  })

  it('resolves nothing without a reference or a colour', () => {
    expect(resolveStyleFontColor(undefined, theme)).toBeUndefined()
    expect(resolveStyleFontColor({ idx: 'minor' }, theme)).toBeUndefined()
  })

  /** `idx="none"` still carries a colour in real files, and that colour is still the text colour. */
  it('resolves the colour even when the font slot is none', () => {
    expect(resolveStyleFontColor({ idx: 'none', color: { type: 'scheme', v: 'lt1' } }, theme))
      .toEqual({ rgb: 'FFFFFF', alpha: 100000 })
  })
})

describe('style matrix font family', () => {
  it('maps the two font collections onto the theme fonts', () => {
    expect(resolveStyleFontFamily({ idx: 'major' }, theme)).toBe('Cambria')
    expect(resolveStyleFontFamily({ idx: 'minor' }, theme)).toBe('Calibri')
  })

  /** `none` means "no font from the style matrix", so nothing is invented. */
  it('resolves nothing for none or a missing reference', () => {
    expect(resolveStyleFontFamily({ idx: 'none' }, theme)).toBeUndefined()
    expect(resolveStyleFontFamily(undefined, theme)).toBeUndefined()
  })

  /** Same fallback `+mj-lt` already uses, so canvas and exporter cannot disagree. */
  it('falls back to the built-in defaults without a theme', () => {
    expect(resolveStyleFontFamily({ idx: 'major' })).toBe('Aptos Display')
    expect(resolveStyleFontFamily({ idx: 'minor' })).toBe('Aptos')
  })
})

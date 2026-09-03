import { describe, expect, it } from 'vitest'
import { resolveStyleFill, resolveStyleLine, type Theme } from './index'

const theme: Theme = {
  id: 'theme-1',
  colors: { accent1: { type: 'srgb', v: '4472C4' } },
  formatScheme: {
    fillStyles: [
      { color: { type: 'scheme', v: 'phClr' } },
      null,
      { color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'tint', value: 60000 }] } },
    ],
    lineStyles: [{ color: { type: 'scheme', v: 'phClr' } }],
  },
}

describe('style matrix resolution', () => {
  it('resolves a solid entry through the reference colour', () => {
    expect(resolveStyleFill({ idx: 1, color: { type: 'scheme', v: 'accent1' } }, theme)).toEqual({ rgb: '4472C4', alpha: 100000 })
  })

  /** `idx="0"` is OOXML for "none". */
  it('resolves index zero to nothing', () => {
    expect(resolveStyleFill({ idx: 0, color: { type: 'scheme', v: 'accent1' } }, theme)).toBeUndefined()
  })

  it('resolves an entry it cannot express to nothing', () => {
    expect(resolveStyleFill({ idx: 2, color: { type: 'scheme', v: 'accent1' } }, theme)).toBeUndefined()
  })

  it('resolves an index past the list to nothing', () => {
    expect(resolveStyleFill({ idx: 9, color: { type: 'scheme', v: 'accent1' } }, theme)).toBeUndefined()
  })

  /** The reference colour settles the base, the entry's own transforms modify it. */
  it('keeps transforms from both sides, reference first', () => {
    const shaded = resolveStyleFill({ idx: 3, color: { type: 'scheme', v: 'accent1', transforms: [{ type: 'shade', value: 50000 }] } }, theme)
    const shadeOnly = resolveStyleFill({ idx: 1, color: { type: 'scheme', v: 'accent1', transforms: [{ type: 'shade', value: 50000 }] } }, theme)

    expect(shaded).toBeDefined()
    expect(shaded).not.toEqual(shadeOnly)
  })

  it('resolves nothing without a reference, a theme, or a format scheme', () => {
    expect(resolveStyleFill(undefined, theme)).toBeUndefined()
    expect(resolveStyleFill({ idx: 1, color: { type: 'scheme', v: 'accent1' } })).toBeUndefined()
    expect(resolveStyleFill({ idx: 1, color: { type: 'scheme', v: 'accent1' } }, { id: 't', colors: {} })).toBeUndefined()
  })

  /** A reference with no colour leaves `phClr` unsubstituted, which resolves to nothing rather than a wrong colour. */
  it('resolves nothing when the reference supplies no colour', () => {
    expect(resolveStyleFill({ idx: 1 }, theme)).toBeUndefined()
  })

  it('reads line entries from their own list', () => {
    expect(resolveStyleLine({ idx: 1, color: { type: 'scheme', v: 'accent1' } }, theme)).toEqual({ rgb: '4472C4', alpha: 100000 })
    expect(resolveStyleLine({ idx: 3, color: { type: 'scheme', v: 'accent1' } }, theme)).toBeUndefined()
  })
})

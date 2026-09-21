import { describe, expect, it } from 'vitest'
import { resolveSlideBackground, resolveStyleFill, resolveStyleFillGradient, type Theme } from './index'

/** Stop colours as a stock Office entry writes them: phClr all the way down, with transforms. */
const theme: Theme = {
  id: 'theme-1',
  colors: { accent1: { type: 'srgb', v: '4472C4' }, lt1: { type: 'srgb', v: 'FFFFFF' } },
  formatScheme: {
    fillStyles: [
      { color: { type: 'scheme', v: 'phClr' } },
      {
        color: { type: 'scheme', v: 'phClr' },
        gradient: {
          stops: [
            { pos: 0, color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'tint', value: 67000 }] } },
            { pos: 100000, color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'shade', value: 60000 }] } },
          ],
          angle: 5400000,
          scaled: false,
        },
      },
      null,
    ],
    backgroundStyles: [
      { color: { type: 'scheme', v: 'phClr' } },
      {
        color: { type: 'scheme', v: 'phClr' },
        gradient: {
          stops: [
            { pos: 0, color: { type: 'scheme', v: 'phClr' } },
            { pos: 100000, color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'tint', value: 40000 }] } },
          ],
        },
      },
    ],
  },
}

const reference = (idx: number) => ({ idx, color: { type: 'scheme' as const, v: 'accent1' } })

describe('theme gradient entry resolution', () => {
  /** The core of the slice: every stop needs phClr substituted, not just the entry's own colour. */
  it('substitutes phClr per stop and resolves each one', () => {
    const gradient = resolveStyleFillGradient(reference(2), theme)

    expect(gradient?.stops).toHaveLength(2)
    expect(gradient?.stops[0]?.pos).toBe(0)
    expect(gradient?.stops[0]?.color.rgb).not.toBe('4472C4')
    expect(gradient?.stops[1]?.color.rgb).not.toBe('4472C4')
    expect(gradient?.stops[0]?.color.rgb).not.toBe(gradient?.stops[1]?.color.rgb)
    expect(gradient?.angle).toBe(5400000)
    expect(gradient?.scaled).toBe(false)
  })

  /** The reference colour settles the base, so a lighter tint stop stays lighter than a shade stop. */
  it('keeps the reference colour as the base of every stop', () => {
    const tinted = resolveStyleFillGradient(reference(2), theme)?.stops[0]?.color.rgb ?? ''
    const shaded = resolveStyleFillGradient(reference(2), theme)?.stops[1]?.color.rgb ?? ''

    expect(Number.parseInt(tinted.slice(0, 2), 16)).toBeGreaterThan(Number.parseInt(shaded.slice(0, 2), 16))
  })

  it('resolves a solid entry to no gradient', () => {
    expect(resolveStyleFillGradient(reference(1), theme)).toBeUndefined()
  })

  it('resolves index zero, a null entry and an out-of-range index to nothing', () => {
    expect(resolveStyleFillGradient(reference(0), theme)).toBeUndefined()
    expect(resolveStyleFillGradient(reference(3), theme)).toBeUndefined()
    expect(resolveStyleFillGradient(reference(9), theme)).toBeUndefined()
  })

  /** With no substitute for phClr no stop resolves, so there is no ramp to paint. */
  it('resolves nothing when the reference supplies no colour', () => {
    expect(resolveStyleFillGradient({ idx: 2 }, theme)).toBeUndefined()
  })

  it('resolves nothing without a theme or a format scheme', () => {
    expect(resolveStyleFillGradient(reference(2))).toBeUndefined()
    expect(resolveStyleFillGradient(reference(2), { id: 't', colors: {} })).toBeUndefined()
  })

  /** The entry's own colour still resolves, so a consumer reading only it paints flat. */
  it('still resolves the entry colour for the same reference', () => {
    expect(resolveStyleFill(reference(2), theme)).toEqual({ rgb: '4472C4', alpha: 100000 })
  })
})

describe('gradient background entries', () => {
  /**
   * A gradient background entry used to be `null` and painted nothing. Now its first stop resolves,
   * so the page is at least the right family of colour. Painting the ramp is a separate slice.
   */
  it('resolves a gradient background entry to its first stop', () => {
    const slide = { id: 'sld_1', elementIds: [], background: { styleRef: reference(1002) } }

    expect(resolveSlideBackground(slide, undefined, undefined, theme)).toEqual({ rgb: '4472C4', alpha: 100000 })
  })

  it('still resolves a solid background entry', () => {
    const slide = { id: 'sld_1', elementIds: [], background: { styleRef: { idx: 1001, color: { type: 'scheme' as const, v: 'lt1' } } } }

    expect(resolveSlideBackground(slide, undefined, undefined, theme)).toEqual({ rgb: 'FFFFFF', alpha: 100000 })
  })
})

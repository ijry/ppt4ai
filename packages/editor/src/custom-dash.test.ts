import { describe, expect, it } from 'vitest'
import { dashPattern } from './shape-painting'

/**
 * `a:custDash` needs no approximation: each `a:ds` states its own length and gap as a percentage of
 * the line width, so the painter converts rather than guesses. This is the one dash form whose canvas
 * pattern is exact — see `preset-dash.test.ts` for the eleven tokens that are grouped instead.
 */
describe('custom dash patterns', () => {
  it('converts one segment into a dash and a gap', () => {
    expect(dashPattern({ custom: [{ dash: 100000, space: 50000 }] }, 10)).toEqual([10, 5])
  })

  it('flattens every segment in order', () => {
    expect(dashPattern({ custom: [{ dash: 400000, space: 300000 }, { dash: 100000, space: 300000 }] }, 10))
      .toEqual([40, 30, 10, 30])
  })

  /** These percentages are relative to the width, so a segment longer than the line is ordinary. */
  it('keeps a segment longer than the line width', () => {
    expect(dashPattern({ custom: [{ dash: 800000, space: 100000 }] }, 5)).toEqual([40, 5])
  })

  /** Canvas throws on a negative or non-finite entry, and an all-zero array paints solid anyway. */
  it('paints nothing when the line has no width', () => {
    expect(dashPattern({ custom: [{ dash: 400000, space: 300000 }] }, 0)).toEqual([])
  })

  it('paints nothing for an empty segment list', () => {
    expect(dashPattern({ custom: [] }, 10)).toEqual([])
  })
})

import type { StrokeStyle } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { dashPattern } from './shape-painting'
import { STROKE_STYLE_OPTIONS, strokeStyleOptions } from './shape-paint-toolbar'

/**
 * The eleven `a:prstDash` tokens reach the model verbatim; the painter groups them into four
 * structures. `lg` and `sys` deliberately paint like their base word — ECMA-376's exact lengths could
 * not be verified in this environment, so no magnitudes are invented for them (see the slice design).
 */
describe('preset dash patterns', () => {
  it('paints nothing for solid and for an unknown word', () => {
    expect(dashPattern('solid', 10)).toEqual([])
    expect(dashPattern('squiggle' as StrokeStyle, 10)).toEqual([])
  })

  it('paints the dot family as dots', () => {
    expect(dashPattern('dot', 10)).toEqual([10, 20])
    expect(dashPattern('sysDot', 10)).toEqual([10, 20])
  })

  it('paints the dash family as dashes', () => {
    expect(dashPattern('dash', 10)).toEqual([40, 30])
    expect(dashPattern('lgDash', 10)).toEqual([40, 30])
    expect(dashPattern('sysDash', 10)).toEqual([40, 30])
  })

  /** The visible win: these three used to be indistinguishable from a plain dash. */
  it('paints the dash-dot family as a dash followed by a dot', () => {
    for (const style of ['dashDot', 'lgDashDot', 'sysDashDot'] as const) {
      expect(dashPattern(style, 10)).toEqual([40, 30, 10, 20])
    }
  })

  it('paints the dash-dot-dot family with two dots', () => {
    for (const style of ['lgDashDotDot', 'sysDashDotDot'] as const) {
      expect(dashPattern(style, 10)).toEqual([40, 30, 10, 20, 10, 20])
    }
  })

  it('scales every pattern with the line width', () => {
    expect(dashPattern('dashDot', 2)).toEqual([8, 6, 2, 4])
  })
})

describe('stroke style options', () => {
  it('offers the three authoring choices for a style it can express', () => {
    expect(strokeStyleOptions(undefined)).toEqual(STROKE_STYLE_OPTIONS)
    expect(strokeStyleOptions('dash')).toEqual(STROKE_STYLE_OPTIONS)
    expect(strokeStyleOptions('solid')).toEqual(STROKE_STYLE_OPTIONS)
  })

  /**
   * A `<select>` whose value matches no option falls back to the first one, which would report a
   * `lgDashDot` outline as Solid. The imported word therefore joins the list.
   */
  it('adds the token the element already carries when the source used one of the other eight', () => {
    expect(strokeStyleOptions('lgDashDot')).toEqual([...STROKE_STYLE_OPTIONS, 'lgDashDot'])
    expect(strokeStyleOptions('sysDot')).toEqual([...STROKE_STYLE_OPTIONS, 'sysDot'])
  })
})

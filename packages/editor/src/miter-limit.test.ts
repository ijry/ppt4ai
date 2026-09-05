import { describe, expect, it } from 'vitest'
import { canvasMiterLimit } from './shape-painting'

/**
 * `a:miter/@lim` is a percentage of the line width; canvas's `miterLimit` is the ratio of miter length
 * to line width. Same reference length, so the percentage converts straight across.
 */
describe('canvas miter limit', () => {
  it('converts the percentage to a ratio', () => {
    expect(canvasMiterLimit(800000)).toBe(8)
    expect(canvasMiterLimit(1000000)).toBe(10)
    expect(canvasMiterLimit(100000)).toBe(1)
  })

  /** Canvas's own default, so a shape that states no limit keeps the behaviour it had. */
  it('falls back to the canvas default', () => {
    expect(canvasMiterLimit(undefined)).toBe(10)
  })

  it('falls back for a value that is not usable', () => {
    expect(canvasMiterLimit(0)).toBe(10)
    expect(canvasMiterLimit(-5)).toBe(10)
  })
})

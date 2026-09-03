import { describe, expect, it } from 'vitest'
import { gradientAxis, type GradientAxis } from './index'

const wide = { x: 0, y: 0, w: 200, h: 100 }

/** Trig makes exact equality wrong here: cos(90 degrees) is not exactly zero in floating point. */
function expectAxis(axis: GradientAxis, from: [number, number], to: [number, number]): void {
  expect(axis.from.x).toBeCloseTo(from[0])
  expect(axis.from.y).toBeCloseTo(from[1])
  expect(axis.to.x).toBeCloseTo(to[0])
  expect(axis.to.y).toBeCloseTo(to[1])
}

describe('gradient axis', () => {
  /** `ang="5400000"` is 90 degrees, the stock Office top-to-bottom gradient. */
  it('runs top to bottom at ninety degrees', () => {
    expectAxis(gradientAxis(wide, 5400000), [100, 0], [100, 100])
  })

  it('runs left to right at zero degrees', () => {
    expectAxis(gradientAxis(wide, 0), [0, 50], [200, 50])
  })

  it('runs bottom to top at 270 degrees', () => {
    expectAxis(gradientAxis(wide, 16200000), [100, 100], [100, 0])
  })

  /** The box's own extent along the axis, so the ramp covers it exactly and never clips short. */
  it('spans the whole box at an angle', () => {
    expectAxis(gradientAxis({ x: 0, y: 0, w: 100, h: 100 }, 2700000), [0, 0], [100, 100])
  })

  /**
   * The example that tells the two modes apart: on a box twice as wide as it is tall, a scaled 45
   * degrees is the box diagonal, an unscaled one is a true 45 degrees.
   */
  it('follows the box diagonal when scaled', () => {
    expectAxis(gradientAxis(wide, 2700000, true), [0, 0], [200, 100])
  })

  it('keeps a true angle when not scaled', () => {
    const plain = gradientAxis(wide, 2700000, false)
    const dx = plain.to.x - plain.from.x
    const dy = plain.to.y - plain.from.y

    expect(dy / dx).toBeCloseTo(1)
    expect(dx).toBeCloseTo(150)
  })

  it('agrees between the two modes at ninety degrees', () => {
    const scaled = gradientAxis(wide, 5400000, true)

    expectAxis(gradientAxis(wide, 5400000, false), [scaled.from.x, scaled.from.y], [scaled.to.x, scaled.to.y])
  })

  it('honours the box offset', () => {
    expectAxis(gradientAxis({ x: 10, y: 20, w: 200, h: 100 }, 5400000), [110, 20], [110, 120])
  })

  /** A zero-area box has no axis; a degenerate one paints the last stop rather than throwing. */
  it('collapses to the centre for a zero-size box when scaled', () => {
    expectAxis(gradientAxis({ x: 5, y: 7, w: 0, h: 0 }, 2700000, true), [5, 7], [5, 7])
  })

  it('defaults to a left-to-right axis with no angle given', () => {
    expectAxis(gradientAxis(wide), [0, 50], [200, 50])
  })
})

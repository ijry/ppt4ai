import { describe, expect, it } from 'vitest'
import { gradientFocus } from './index'

const box = { x: 100, y: 200, w: 400, h: 200 }

describe('gradient focus', () => {
  /** `l=t=r=b=50000` collapses the convergence rect to the box centre, which is a centred gradient. */
  it('puts a fully inset rect at the box centre and reaches the farthest corner', () => {
    const focus = gradientFocus(box, { left: 50000, top: 50000, right: 50000, bottom: 50000 })

    expect(focus.centre).toEqual({ x: 300, y: 300 })
    expect(focus.radius).toBeCloseTo(Math.hypot(200, 100), 6)
  })

  it('treats an absent rect as no inset, which is also the centre', () => {
    expect(gradientFocus(box).centre).toEqual({ x: 300, y: 300 })
  })

  /** `l=100000 r=0` degenerates onto the right edge — how OOXML writes a corner gradient. */
  it('follows a rect collapsed onto one corner', () => {
    const focus = gradientFocus(box, { left: 100000, top: 100000, right: 0, bottom: 0 })

    expect(focus.centre).toEqual({ x: 500, y: 400 })
    expect(focus.radius).toBeCloseTo(Math.hypot(400, 200), 6)
  })

  it('handles a partial rect by insetting only the sides it states', () => {
    // Only the left inset moves: the rect runs from x=200 to the box's right edge, so its centre is 350.
    expect(gradientFocus(box, { left: 25000 }).centre).toEqual({ x: 350, y: 300 })
    expect(gradientFocus(box, { top: 100000 }).centre).toEqual({ x: 300, y: 400 })
  })

  it('gives a degenerate box a zero radius rather than a NaN', () => {
    const focus = gradientFocus({ x: 10, y: 20, w: 0, h: 0 })

    expect(focus.centre).toEqual({ x: 10, y: 20 })
    expect(focus.radius).toBe(0)
  })
})

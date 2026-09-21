import { describe, expect, it } from 'vitest'
import { rotationFromPointer } from './image-transform'

describe('image transform geometry', () => {
  it('computes a clockwise quarter turn in OOXML units', () => {
    expect(rotationFromPointer(0, { x: 50, y: 50 }, { x: 50, y: 0 }, { x: 100, y: 50 })).toBe(5400000)
  })

  it('adds a starting rotation and snaps Shift rotations to fifteen degrees', () => {
    const radians = 17 * Math.PI / 180
    expect(rotationFromPointer(
      1800000,
      { x: 0, y: 0 },
      { x: 0, y: -100 },
      { x: Math.sin(radians) * 100, y: -Math.cos(radians) * 100 },
      true,
    )).toBe(2700000)
  })

  it('unwraps a pointer crossing the negative-positive angle boundary', () => {
    const start = { x: Math.cos(Math.PI - 0.05) * 100, y: Math.sin(Math.PI - 0.05) * 100 }
    const current = { x: Math.cos(-Math.PI + 0.05) * 100, y: Math.sin(-Math.PI + 0.05) * 100 }
    expect(rotationFromPointer(0, { x: 0, y: 0 }, start, current)).toBe(343775)
  })

  it('rejects non-finite rotation inputs', () => {
    expect(() => rotationFromPointer(0, { x: Number.NaN, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toThrow('rotation points must be finite')
  })
})

import { describe, expect, it } from 'vitest'
import { emuFromPoints, pointsFromEmu, STROKE_STYLE_OPTIONS } from './shape-paint-toolbar'

describe('stroke width unit conversion', () => {
  /** `a:ln/@w` is EMU and one point is 12700 of them. */
  it('converts between points and EMU', () => {
    expect(emuFromPoints(1)).toBe(12700)
    expect(emuFromPoints(6)).toBe(76200)
    expect(pointsFromEmu(12700)).toBe(1)
    expect(pointsFromEmu(76200)).toBe(6)
  })

  it('keeps zero in both directions', () => {
    expect(emuFromPoints(0)).toBe(0)
    expect(pointsFromEmu(0)).toBe(0)
  })

  it('accepts a string from a number input', () => {
    expect(emuFromPoints('2.5')).toBe(31750)
    expect(emuFromPoints(' 3 ')).toBe(38100)
  })

  /** The model only accepts integer EMU, so a fractional point value has to round. */
  it('rounds to a whole EMU', () => {
    expect(emuFromPoints(0.7)).toBe(8890)
    expect(Number.isInteger(emuFromPoints(1 / 3))).toBe(true)
  })

  it('rejects a negative or unusable value', () => {
    expect(emuFromPoints(-1)).toBeUndefined()
    expect(emuFromPoints('wide')).toBeUndefined()
    expect(emuFromPoints('')).toBeUndefined()
  })

  /** An absent width is inherited from the theme, so it has no point value to show. */
  it('resolves an absent or unusable EMU width to nothing', () => {
    expect(pointsFromEmu(undefined)).toBeUndefined()
    expect(pointsFromEmu(-5)).toBeUndefined()
    expect(pointsFromEmu(Number.NaN)).toBeUndefined()
  })

  it('offers exactly the three modeled dash styles', () => {
    expect(STROKE_STYLE_OPTIONS).toEqual(['solid', 'dash', 'dot'])
  })
})

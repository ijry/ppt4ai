import { describe, expect, it } from 'vitest'
import {
  containsRotatedPoint,
  rotatePointAround,
  rotationRadians,
  rotationUnitsFromRadians,
  type GeometryBounds,
} from './index'

const bounds: GeometryBounds = { x: 100, y: 100, w: 200, h: 100 }
const centre = { x: 200, y: 150 }
const quarterTurn = 5400000

describe('rotatePointAround', () => {
  it('returns the point unchanged for zero rotation', () => {
    expect(rotatePointAround({ x: 130, y: 170 }, centre, 0)).toEqual({ x: 130, y: 170 })
  })

  it('leaves the centre fixed under any rotation', () => {
    const rotated = rotatePointAround(centre, centre, 1234567)
    expect(rotated.x).toBeCloseTo(centre.x, 9)
    expect(rotated.y).toBeCloseTo(centre.y, 9)
  })

  it('rotates a quarter turn clockwise in screen coordinates', () => {
    const rotated = rotatePointAround({ x: 300, y: 150 }, centre, quarterTurn)
    expect(rotated.x).toBeCloseTo(200, 6)
    expect(rotated.y).toBeCloseTo(250, 6)
  })

  it('composes additively, so two rotations equal their sum', () => {
    const point = { x: 275, y: 120 }
    const twice = rotatePointAround(rotatePointAround(point, centre, 900000), centre, 900000)
    const once = rotatePointAround(point, centre, 1800000)
    expect(twice.x).toBeCloseTo(once.x, 6)
    expect(twice.y).toBeCloseTo(once.y, 6)
  })

  it('inverts under the negated angle', () => {
    const point = { x: 141, y: 187 }
    const roundTrip = rotatePointAround(rotatePointAround(point, centre, 777777), centre, -777777)
    expect(roundTrip.x).toBeCloseTo(point.x, 6)
    expect(roundTrip.y).toBeCloseTo(point.y, 6)
  })

  it('treats a full turn as the identity', () => {
    const point = { x: 111, y: 199 }
    const rotated = rotatePointAround(point, centre, 21600000)
    expect(rotated.x).toBeCloseTo(point.x, 6)
    expect(rotated.y).toBeCloseTo(point.y, 6)
  })
})

describe('containsRotatedPoint', () => {
  it('falls back to an axis-aligned test without rotation', () => {
    expect(containsRotatedPoint(bounds, { x: 150, y: 150 }, undefined)).toBe(true)
    expect(containsRotatedPoint(bounds, { x: 350, y: 150 }, undefined)).toBe(false)
  })

  it('includes points on the boundary', () => {
    expect(containsRotatedPoint(bounds, { x: 100, y: 100 }, undefined)).toBe(true)
    expect(containsRotatedPoint(bounds, { x: 300, y: 200 }, 0)).toBe(true)
  })

  it('accepts a point inside the rotated rectangle but outside its unrotated box', () => {
    expect(containsRotatedPoint(bounds, { x: 200, y: 240 }, quarterTurn)).toBe(true)
    expect(containsRotatedPoint(bounds, { x: 200, y: 240 }, undefined)).toBe(false)
  })

  it('rejects a point inside the unrotated box but outside the rotated rectangle', () => {
    expect(containsRotatedPoint(bounds, { x: 290, y: 150 }, quarterTurn)).toBe(false)
    expect(containsRotatedPoint(bounds, { x: 290, y: 150 }, undefined)).toBe(true)
  })

  it('keeps the centre inside regardless of rotation', () => {
    for (const rotation of [0, 900000, 5400000, 12345678, -3000000]) {
      expect(containsRotatedPoint(bounds, centre, rotation)).toBe(true)
    }
  })
})

describe('rotationUnitsFromRadians', () => {
  it('converts a quarter turn of radians back to OOXML units', () => {
    expect(rotationUnitsFromRadians(Math.PI / 2)).toBeCloseTo(quarterTurn, 6)
  })

  it('round-trips against rotationRadians', () => {
    for (const units of [0, 900000, 5400000, 12345678, -3000000]) {
      expect(rotationUnitsFromRadians(rotationRadians(units))).toBeCloseTo(units, 6)
    }
  })

  it('keeps the sign of negative angles', () => {
    expect(rotationUnitsFromRadians(-Math.PI)).toBeCloseTo(-10800000, 6)
  })
})

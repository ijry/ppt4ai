import { describe, expect, it } from 'vitest'
import { boundsCentre, cascadeRotation, rotatePointAround, type GeometryBounds, type RotationPivot } from './index'

const quarterTurn = 5400000
const halfTurn = 10800000

const child: GeometryBounds = { x: 400, y: 100, w: 100, h: 40 }

describe('cascadeRotation', () => {
  it('returns the original bounds and zero rotation with no ancestors and no own rotation', () => {
    const result = cascadeRotation(child, undefined, [])

    expect(result).toEqual({ bounds: child, rotation: 0 })
  })

  it('keeps its own rotation when there are no ancestors', () => {
    expect(cascadeRotation(child, quarterTurn, [])).toEqual({ bounds: child, rotation: quarterTurn })
  })

  it('adds the ancestor rotation and moves the centre about the ancestor pivot', () => {
    const pivot = { x: 300, y: 300 }
    const result = cascadeRotation(child, 0, [{ pivot, rotation: quarterTurn }])
    const expectedCentre = rotatePointAround(boundsCentre(child), pivot, quarterTurn)

    expect(result.rotation).toBe(quarterTurn)
    expect(boundsCentre(result.bounds).x).toBeCloseTo(expectedCentre.x, 6)
    expect(boundsCentre(result.bounds).y).toBeCloseTo(expectedCentre.y, 6)
  })

  it('preserves width and height, so cascading never shears the rectangle', () => {
    const result = cascadeRotation(child, 300000, [
      { pivot: { x: 0, y: 0 }, rotation: 1234567 },
      { pivot: { x: 900, y: 250 }, rotation: -765432 },
    ])

    expect(result.bounds.w).toBe(child.w)
    expect(result.bounds.h).toBe(child.h)
  })

  it('sums own and every ancestor rotation', () => {
    const ancestors: RotationPivot[] = [
      { pivot: { x: 10, y: 20 }, rotation: 900000 },
      { pivot: { x: 30, y: 40 }, rotation: 1800000 },
    ]

    expect(cascadeRotation(child, 300000, ancestors).rotation).toBe(3000000)
  })

  it('leaves a centre that sits exactly on the ancestor pivot fixed', () => {
    const pivot = boundsCentre(child)
    const result = cascadeRotation(child, 0, [{ pivot, rotation: 1234567 }])

    expect(boundsCentre(result.bounds).x).toBeCloseTo(pivot.x, 6)
    expect(boundsCentre(result.bounds).y).toBeCloseTo(pivot.y, 6)
  })

  it('applies ancestors innermost first, so pivot order is not interchangeable', () => {
    const outer: RotationPivot = { pivot: { x: 0, y: 0 }, rotation: quarterTurn }
    const inner: RotationPivot = { pivot: { x: 500, y: 500 }, rotation: quarterTurn }

    const outerFirst = cascadeRotation(child, 0, [outer, inner])
    const innerFirst = cascadeRotation(child, 0, [inner, outer])

    expect(boundsCentre(outerFirst.bounds)).not.toEqual(boundsCentre(innerFirst.bounds))
  })

  it('matches a hand-folded two-level nesting, innermost ancestor applied first', () => {
    const outer: RotationPivot = { pivot: { x: 0, y: 0 }, rotation: quarterTurn }
    const inner: RotationPivot = { pivot: { x: 500, y: 200 }, rotation: halfTurn }

    const result = cascadeRotation(child, 0, [outer, inner])
    const afterInner = rotatePointAround(boundsCentre(child), inner.pivot, inner.rotation)
    const afterOuter = rotatePointAround(afterInner, outer.pivot, outer.rotation)

    expect(boundsCentre(result.bounds).x).toBeCloseTo(afterOuter.x, 6)
    expect(boundsCentre(result.bounds).y).toBeCloseTo(afterOuter.y, 6)
    expect(result.rotation).toBe(quarterTurn + halfTurn)
  })

  it('cancels out when an ancestor rotation is undone by its inverse', () => {
    const pivot = { x: 250, y: 375 }
    const result = cascadeRotation(child, 0, [
      { pivot, rotation: -1234567 },
      { pivot, rotation: 1234567 },
    ])

    expect(boundsCentre(result.bounds).x).toBeCloseTo(boundsCentre(child).x, 6)
    expect(boundsCentre(result.bounds).y).toBeCloseTo(boundsCentre(child).y, 6)
    expect(result.rotation).toBe(0)
  })

  it('ignores ancestors with zero rotation', () => {
    const result = cascadeRotation(child, quarterTurn, [{ pivot: { x: 7, y: 9 }, rotation: 0 }])

    expect(result).toEqual({ bounds: child, rotation: quarterTurn })
  })
})

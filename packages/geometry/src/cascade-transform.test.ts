import { describe, expect, it } from 'vitest'
import { boundsCentre, cascadeTransform, rotatePointAround, type GeometryBounds, type GroupTransform } from './index'

const quarterTurn = 5400000
const halfTurn = 10800000

const child: GeometryBounds = { x: 400, y: 100, w: 100, h: 40 }
const groupCentre = { x: 500, y: 300 }

describe('cascadeTransform', () => {
  it('returns the input untouched with no ancestors and no own transform', () => {
    expect(cascadeTransform(child, {}, [])).toEqual({ bounds: child, rotation: 0, flipH: false, flipV: false })
  })

  it('passes an element\'s own flips through unchanged', () => {
    expect(cascadeTransform(child, { flipH: true }, [])).toEqual({ bounds: child, rotation: 0, flipH: true, flipV: false })
  })

  it('mirrors the centre across the ancestor\'s vertical axis and toggles flipH', () => {
    const result = cascadeTransform(child, {}, [{ pivot: groupCentre, flipH: true }])

    expect(boundsCentre(result.bounds)).toEqual({ x: 2 * groupCentre.x - 450, y: 120 })
    expect(result.flipH).toBe(true)
    expect(result.flipV).toBe(false)
  })

  it('mirrors the centre across the ancestor\'s horizontal axis and toggles flipV', () => {
    const result = cascadeTransform(child, {}, [{ pivot: groupCentre, flipV: true }])

    expect(boundsCentre(result.bounds)).toEqual({ x: 450, y: 2 * groupCentre.y - 120 })
    expect(result.flipV).toBe(true)
    expect(result.flipH).toBe(false)
  })

  it('preserves width and height, because a mirror is an isometry', () => {
    const result = cascadeTransform(child, {}, [{ pivot: groupCentre, flipH: true, flipV: true }])

    expect(result.bounds.w).toBe(child.w)
    expect(result.bounds.h).toBe(child.h)
  })

  it('leaves a descendant centred on the pivot where it is', () => {
    const centred: GeometryBounds = { x: 450, y: 280, w: 100, h: 40 }

    expect(cascadeTransform(centred, {}, [{ pivot: groupCentre, flipH: true, flipV: true }]).bounds).toEqual(centred)
  })

  it('cancels an equal descendant flip, since two mirrors about parallel axes compose to identity', () => {
    const result = cascadeTransform(child, { flipH: true }, [{ pivot: boundsCentre(child), flipH: true }])

    expect(result).toEqual({ bounds: child, rotation: 0, flipH: false, flipV: false })
  })

  it('cancels a nested pair of equal flips', () => {
    const outer: GroupTransform = { pivot: groupCentre, flipH: true }
    const inner: GroupTransform = { pivot: groupCentre, flipH: true }

    expect(cascadeTransform(child, {}, [outer, inner])).toEqual({ bounds: child, rotation: 0, flipH: false, flipV: false })
  })

  it('negates the descendant rotation on one flip axis, because a mirror reverses the sense of an angle', () => {
    expect(cascadeTransform(child, { rotation: 300000 }, [{ pivot: groupCentre, flipH: true }]).rotation).toBe(-300000)
  })

  it('keeps the descendant rotation when both axes flip, which is the same map as a half turn', () => {
    const result = cascadeTransform(child, { rotation: 300000 }, [{ pivot: groupCentre, flipH: true, flipV: true }])

    expect(result.rotation).toBe(300000)
    expect(result).toMatchObject({ flipH: true, flipV: true })
  })

  it('reports zero rather than negative zero so callers can drop the field', () => {
    const result = cascadeTransform(child, {}, [{ pivot: groupCentre, flipH: true }])

    expect(Object.is(result.rotation, 0)).toBe(true)
  })

  it('applies the ancestor flip before its rotation, matching how OOXML reads a:xfrm', () => {
    const result = cascadeTransform(child, {}, [{ pivot: groupCentre, flipH: true, rotation: quarterTurn }])
    const mirrored = { x: 2 * groupCentre.x - 450, y: 120 }
    const expected = rotatePointAround(mirrored, groupCentre, quarterTurn)

    expect(boundsCentre(result.bounds).x).toBeCloseTo(expected.x, 6)
    expect(boundsCentre(result.bounds).y).toBeCloseTo(expected.y, 6)
    expect(result.rotation).toBe(quarterTurn)
  })

  it('applies ancestors innermost first', () => {
    const outer: GroupTransform = { pivot: { x: 0, y: 0 }, rotation: quarterTurn }
    const inner: GroupTransform = { pivot: groupCentre, flipH: true }

    const result = cascadeTransform(child, {}, [outer, inner])
    const afterInner = { x: 2 * groupCentre.x - 450, y: 120 }
    const afterOuter = rotatePointAround(afterInner, outer.pivot, quarterTurn)

    expect(boundsCentre(result.bounds).x).toBeCloseTo(afterOuter.x, 6)
    expect(boundsCentre(result.bounds).y).toBeCloseTo(afterOuter.y, 6)
  })

  it('sums rotations and folds flips across a mixed chain', () => {
    const result = cascadeTransform(child, { rotation: 300000 }, [
      { pivot: { x: 0, y: 0 }, rotation: halfTurn },
      { pivot: groupCentre, flipV: true },
    ])

    // The inner mirror negates 300000 first, then the outer half turn adds to it.
    expect(result.rotation).toBe(halfTurn - 300000)
    expect(result.flipV).toBe(true)
  })

  it('ignores ancestors that carry no transform at all', () => {
    expect(cascadeTransform(child, { rotation: quarterTurn }, [{ pivot: { x: 7, y: 9 } }]))
      .toEqual({ bounds: child, rotation: quarterTurn, flipH: false, flipV: false })
  })
})

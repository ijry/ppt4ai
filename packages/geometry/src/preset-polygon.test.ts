import { describe, expect, it } from 'vitest'
import { PAINTED_PRESET_GEOMETRIES } from '@ppt4ai/model'
import { createPresetPath } from './index'

const box = { x: 0, y: 0, w: 100, h: 100 }

function pointsOf(preset: string, bounds = box) {
  return createPresetPath(preset, bounds)
    .filter((command) => command.type === 'move' || command.type === 'line')
    .map((command) => ({ x: (command as { x: number }).x, y: (command as { y: number }).y }))
}

describe('preset geometry the name determines', () => {
  it('draws a diamond on the four edge midpoints', () => {
    expect(pointsOf('diamond')).toEqual([
      { x: 50, y: 0 },
      { x: 100, y: 50 },
      { x: 50, y: 100 },
      { x: 0, y: 50 },
    ])
  })

  it('draws a right triangle on three of the box corners', () => {
    expect(pointsOf('rightTriangle')).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ])
  })

  it('gives each polygon the vertex count its word states', () => {
    expect(pointsOf('pentagon')).toHaveLength(5)
    expect(pointsOf('hexagon')).toHaveLength(6)
    expect(pointsOf('heptagon')).toHaveLength(7)
    expect(pointsOf('octagon')).toHaveLength(8)
    expect(pointsOf('decagon')).toHaveLength(10)
    expect(pointsOf('dodecagon')).toHaveLength(12)
  })

  /** Point up, the way a pentagon and a hexagon sit in Office. */
  it('starts every polygon at twelve o clock', () => {
    for (const preset of ['pentagon', 'hexagon', 'octagon', 'dodecagon']) {
      const first = pointsOf(preset)[0]!

      expect(first.x, preset).toBeCloseTo(50)
      expect(first.y, preset).toBeCloseTo(0)
    }
  })

  it('keeps every vertex inside the box', () => {
    for (const preset of ['diamond', 'rightTriangle', 'pentagon', 'hexagon', 'heptagon', 'octagon', 'decagon', 'dodecagon']) {
      for (const point of pointsOf(preset)) {
        expect(point.x, preset).toBeGreaterThanOrEqual(0)
        expect(point.x, preset).toBeLessThanOrEqual(100)
        expect(point.y, preset).toBeGreaterThanOrEqual(0)
        expect(point.y, preset).toBeLessThanOrEqual(100)
      }
    }
  })

  /**
   * Half the width and half the height are separate radii, so an oblong box stretches the polygon
   * rather than leaving a circular one centred in it. A twelve-o'clock hexagon reaches the top and
   * bottom edges but not the left and right ones, so the check is that both extents scale with the box.
   */
  it('stretches a polygon to a non-square box', () => {
    const square = pointsOf('hexagon')
    const wide = pointsOf('hexagon', { x: 0, y: 0, w: 200, h: 100 })
    const spread = (points: Array<{ x: number; y: number }>, axis: 'x' | 'y') =>
      Math.max(...points.map((point) => point[axis])) - Math.min(...points.map((point) => point[axis]))

    expect(spread(wide, 'x')).toBeCloseTo(spread(square, 'x') * 2)
    expect(spread(wide, 'y')).toBeCloseTo(spread(square, 'y'))
    expect(spread(wide, 'y')).toBeCloseTo(100)
  })

  it('offsets every vertex by the box origin', () => {
    const points = pointsOf('diamond', { x: 30, y: 40, w: 100, h: 100 })

    expect(points[0]).toEqual({ x: 80, y: 40 })
  })

  /** The model's list and this module must not drift apart. */
  it('draws something other than a rectangle for every word the model lists', () => {
    const rectangle = JSON.stringify(createPresetPath('rect', box))
    for (const preset of PAINTED_PRESET_GEOMETRIES.filter((word) => word !== 'rect')) {
      expect(JSON.stringify(createPresetPath(preset, box)), preset).not.toBe(rectangle)
    }
  })

  /** A word whose outline the name does not determine still paints as its box, as it always did. */
  it('still falls back to the bounding rectangle for the rest', () => {
    const rectangle = createPresetPath('rect', box)
    for (const preset of ['chevron', 'star5', 'cloud', 'rightArrow', 'someFutureShape']) {
      expect(createPresetPath(preset, box), preset).toEqual(rectangle)
    }
  })
})

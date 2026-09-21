import { describe, expect, it } from 'vitest'
import { PAINTED_PRESET_PATTERNS } from '@ppt4ai/model'
import { patternGeometry } from './index'

const box = { x: 0, y: 0, w: 100, h: 100 }

function linesOf(preset: string, bounds = box) {
  const geometry = patternGeometry(preset, bounds)
  if (!geometry) throw new Error(`${preset} has no geometry`)
  return geometry.lines
}

describe('pattern geometry', () => {
  it('lays horizontal words out as horizontal lines spanning the box', () => {
    const lines = linesOf('ltHorz')

    expect(lines.every((line) => line.from.y === line.to.y)).toBe(true)
    expect(lines.every((line) => line.from.x === 0 && line.to.x === 100)).toBe(true)
    expect(lines.map((line) => line.from.y)).toEqual([...lines.map((line) => line.from.y)].sort((a, b) => a - b))
  })

  it('lays vertical words out as vertical lines spanning the box', () => {
    const lines = linesOf('ltVert')

    expect(lines.every((line) => line.from.x === line.to.x)).toBe(true)
    expect(lines.every((line) => line.from.y === 0 && line.to.y === 100)).toBe(true)
  })

  /** `dk` is the same direction, drawn heavier — that ordering is what the word states. */
  it('draws the dark tier heavier than the light tier', () => {
    const light = patternGeometry('ltHorz', box)!
    const dark = patternGeometry('dkHorz', box)!

    expect(dark.lineWidth).toBeGreaterThan(light.lineWidth)
    expect(dark.lines.length).toBe(light.lines.length)
  })

  it('draws the narrow tier tighter than the base word', () => {
    expect(linesOf('narHorz').length).toBeGreaterThan(linesOf('horz').length)
  })

  it('draws the wide tier looser than the base word', () => {
    expect(linesOf('wdUpDiag').length).toBeLessThan(linesOf('ltUpDiag').length)
  })

  /** `up` runs bottom-left to top-right, a negative slope in a y-down space; `down` is the mirror. */
  it('leans each diagonal the way its word says', () => {
    const up = linesOf('ltUpDiag')[0]!
    const down = linesOf('ltDnDiag')[0]!

    expect((up.to.y - up.from.y) / (up.to.x - up.from.x)).toBeLessThan(0)
    expect((down.to.y - down.from.y) / (down.to.x - down.from.x)).toBeGreaterThan(0)
  })

  it('covers the corners a diagonal sweep would otherwise miss', () => {
    const lines = linesOf('ltUpDiag')

    expect(Math.min(...lines.map((line) => line.from.x))).toBeLessThan(0)
    expect(Math.max(...lines.map((line) => line.to.x))).toBeGreaterThan(100)
  })

  it('crosses both axes for a grid word', () => {
    expect(linesOf('cross').length).toBe(linesOf('horz').length + linesOf('vert').length)
  })

  it('crosses both diagonals for diagCross', () => {
    expect(linesOf('diagCross').length).toBe(linesOf('ltUpDiag').length + linesOf('ltDnDiag').length)
  })

  it('offsets every line by the box origin', () => {
    const lines = linesOf('ltHorz', { x: 30, y: 40, w: 100, h: 100 })

    expect(lines[0]).toEqual({ from: { x: 30, y: 40 }, to: { x: 130, y: 40 } })
  })

  /** A word this project cannot draw returns nothing, so painting falls back to the foreground colour. */
  it('returns nothing for a word it does not draw', () => {
    expect(patternGeometry('pct50', box)).toBeUndefined()
    expect(patternGeometry('zigZag', box)).toBeUndefined()
    expect(patternGeometry('someFuturePattern', box)).toBeUndefined()
  })

  it('returns nothing for a box with no area', () => {
    expect(patternGeometry('ltHorz', { x: 0, y: 0, w: 0, h: 100 })).toBeUndefined()
    expect(patternGeometry('ltHorz', { x: 0, y: 0, w: 100, h: 0 })).toBeUndefined()
    expect(patternGeometry('ltHorz', { x: 0, y: 0, w: 100, h: -5 })).toBeUndefined()
  })

  /**
   * The model's list and this module must not drift apart. Percentage words are painted by
   * `patternCoverage` instead, so they are excluded here — `pattern-coverage.test.ts` covers the
   * constant as a whole and pins that the two families stay disjoint.
   */
  /** The plain medium diagonals sit between the light and dark tiers, like `horz` between `ltHorz`/`dkHorz`. */
  it('draws the plain diagonals at the medium weight, leaning the way the word says', () => {
    const up = patternGeometry('upDiag', box)!
    const down = patternGeometry('dnDiag', box)!

    expect(up.lineWidth).toBeGreaterThan(patternGeometry('ltUpDiag', box)!.lineWidth)
    expect(up.lineWidth).toBeLessThan(patternGeometry('dkUpDiag', box)!.lineWidth)
    expect((up.lines[0]!.to.y - up.lines[0]!.from.y) / (up.lines[0]!.to.x - up.lines[0]!.from.x)).toBeLessThan(0)
    expect((down.lines[0]!.to.y - down.lines[0]!.from.y) / (down.lines[0]!.to.x - down.lines[0]!.from.x)).toBeGreaterThan(0)
  })

  it('draws every line-shaped word the model says it draws', () => {
    for (const preset of PAINTED_PRESET_PATTERNS.filter((word) => !word.startsWith('pct'))) {
      expect(patternGeometry(preset, box), preset).toBeDefined()
    }
  })
})

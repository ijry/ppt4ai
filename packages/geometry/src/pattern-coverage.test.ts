import { describe, expect, it } from 'vitest'
import { PAINTED_PRESET_PATTERNS } from '@ppt4ai/model'
import { patternCoverage, patternGeometry } from './index'

describe('pattern coverage', () => {
  it('reads the percentage the word states', () => {
    expect(patternCoverage('pct5')).toBeCloseTo(0.05)
    expect(patternCoverage('pct50')).toBe(0.5)
    expect(patternCoverage('pct90')).toBeCloseTo(0.9)
  })

  /** Parsed rather than matched against a list, so a word outside the usual twelve still paints. */
  it('reads a percentage outside the familiar set', () => {
    expect(patternCoverage('pct15')).toBeCloseTo(0.15)
    expect(patternCoverage('pct100')).toBe(1)
  })

  it('rejects a word that is not a percentage', () => {
    for (const preset of ['ltHorz', 'zigZag', 'pct', 'pctfoo', 'pct50x', 'PCT50', 'pct-5']) {
      expect(patternCoverage(preset), preset).toBeUndefined()
    }
  })

  it('rejects a percentage outside 0..100', () => {
    expect(patternCoverage('pct0')).toBeUndefined()
    expect(patternCoverage('pct150')).toBeUndefined()
  })

  /**
   * The two painted families together have to cover the whole constant: a line word must have geometry,
   * a percentage word must have a coverage, and neither may quietly fall through to the flat fallback.
   */
  it('paints every word the model lists, by one route or the other', () => {
    const box = { x: 0, y: 0, w: 100, h: 100 }
    for (const preset of PAINTED_PRESET_PATTERNS) {
      const painted = patternGeometry(preset, box) !== undefined || patternCoverage(preset) !== undefined
      expect(painted, preset).toBe(true)
    }
  })

  it('keeps the two families disjoint', () => {
    const box = { x: 0, y: 0, w: 100, h: 100 }
    for (const preset of PAINTED_PRESET_PATTERNS) {
      const both = patternGeometry(preset, box) !== undefined && patternCoverage(preset) !== undefined
      expect(both, preset).toBe(false)
    }
  })
})

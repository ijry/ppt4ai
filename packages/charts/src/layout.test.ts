import { describe, expect, it } from 'vitest'
import { layoutChart, valueDomain, type ChartSpec } from './index'

const box = { x: 0, y: 0, w: 1000, h: 1000 }

function columnSpec(series: (number | null)[][], categories = series[0]!.map((_, i) => `C${i + 1}`)): ChartSpec {
  return { type: 'column', categories, series: series.map((values, i) => ({ name: `S${i + 1}`, values })) }
}

describe('value domain', () => {
  it('anchors a positive series to a zero baseline', () => {
    expect(valueDomain([{ values: [3, 5] }])).toEqual({ lo: 0, hi: 5 })
  })
  it('spans negative to positive', () => {
    expect(valueDomain([{ values: [-2, 4] }, { values: [1, -6] }])).toEqual({ lo: -6, hi: 4 })
  })
  it('falls back to unit height when everything is zero or missing', () => {
    expect(valueDomain([{ values: [0, null] }])).toEqual({ lo: 0, hi: 1 })
  })
})

describe('column layout', () => {
  it('produces one bar per category per series', () => {
    const primitives = layoutChart(columnSpec([[10, 20], [5, 15]]), box)
    expect(primitives.bars).toHaveLength(4)
  })

  it('sizes bar heights in proportion to values from a shared baseline', () => {
    const bars = layoutChart(columnSpec([[10, 20]]), box).bars
    const [first, second] = bars
    expect(second!.h / first!.h).toBeCloseTo(2, 5) // 20 vs 10 on a 0..20 domain
    expect(first!.y + first!.h).toBeCloseTo(second!.y + second!.h, 5) // same zero baseline
  })

  it('gives a zero value a zero-height bar', () => {
    expect(layoutChart(columnSpec([[0, 8]]), box).bars[0]!.h).toBeCloseTo(0, 5)
  })

  it('clusters a category’s series into adjacent, non-overlapping bars', () => {
    const bars = layoutChart(columnSpec([[10, 20], [30, 40]]), box).bars
    const cat0 = bars.filter((bar) => bar.categoryIndex === 0).sort((a, b) => a.x - b.x)
    expect(cat0).toHaveLength(2)
    expect(cat0[0]!.x + cat0[0]!.w).toBeLessThanOrEqual(cat0[1]!.x + 1e-6)
  })

  it('keeps every bar inside the box', () => {
    for (const bar of layoutChart(columnSpec([[10, 20], [5, 15]]), box).bars) {
      expect(bar.x).toBeGreaterThanOrEqual(box.x)
      expect(bar.x + bar.w).toBeLessThanOrEqual(box.x + box.w + 1e-6)
      expect(bar.y).toBeGreaterThanOrEqual(box.y)
      expect(bar.y + bar.h).toBeLessThanOrEqual(box.y + box.h + 1e-6)
    }
  })

  it('labels every category and draws axes', () => {
    const primitives = layoutChart(columnSpec([[10, 20, 30]]), box)
    expect(primitives.labels.filter((label) => label.role === 'category').map((label) => label.text)).toEqual(['C1', 'C2', 'C3'])
    expect(primitives.axes.length).toBeGreaterThanOrEqual(2)
  })
})

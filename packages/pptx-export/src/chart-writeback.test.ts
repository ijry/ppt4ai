import { describe, expect, it } from 'vitest'
import { chartValueCellEdits, patchChartCache } from './chart-writeback.js'

const chart = (plot: string): string => `<c:chartSpace xmlns:c="c"><c:chart><c:plotArea>${plot}</c:plotArea></c:chart></c:chartSpace>`
const cats = '<c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>'
const barWith = (values: string): string => chart(`<c:barChart><c:ser>${cats}<c:val><c:numRef><c:numCache>${values}</c:numCache></c:numRef></c:val></c:ser></c:barChart>`)
const twoValues = '<c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt>'

describe('patchChartCache', () => {
  it('rewrites a changed value and leaves the untouched ones', () => {
    const out = patchChartCache(barWith(twoValues), ['A', 'B'], [{ values: [10, 35] }])
    expect(out).toContain('<c:v>35</c:v>')
    expect(out).toContain('<c:v>10</c:v>')
    expect(out).not.toContain('<c:v>20</c:v>')
  })

  it('leaves the XML byte-identical when nothing changed', () => {
    const src = barWith(twoValues)
    expect(patchChartCache(src, ['A', 'B'], [{ values: [10, 20] }])).toBe(src)
  })

  it('treats a numerically equal value as unchanged (10 vs 10.0)', () => {
    const src = barWith('<c:pt idx="0"><c:v>10.0</c:v></c:pt>')
    expect(patchChartCache(src, [], [{ values: [10] }])).toBe(src)
  })

  it('rewrites a changed category label', () => {
    const out = patchChartCache(barWith(twoValues), ['A', 'C'], [{ values: [10, 20] }])
    expect(out).toContain('<c:v>C</c:v>')
    expect(out).not.toContain('<c:v>B</c:v>')
  })

  it('returns the input unchanged for a plot type it does not handle', () => {
    const src = chart('<c:scatterChart/>')
    expect(patchChartCache(src, ['A'], [{ values: [1] }])).toBe(src)
  })
})

describe('chartValueCellEdits', () => {
  it('maps edited series values to workbook cells via the series c:f range', () => {
    const xml = chart('<c:barChart><c:ser><c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f>'
      + '<c:numCache><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart>')
    expect(chartValueCellEdits(xml, [{ values: [10, 99] }]).get('Sheet1')).toEqual(new Map([['B2', 10], ['B3', 99]]))
  })

  it('yields no edits for a series with no formula', () => {
    const xml = chart('<c:barChart><c:ser><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart>')
    expect(chartValueCellEdits(xml, [{ values: [10] }]).size).toBe(0)
  })
})

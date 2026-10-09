import { describe, expect, it } from 'vitest'
import { validateDocument, type Ppt4aiDocument } from './index'

function documentWithChart(chart: unknown): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_chart',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_chart'] } },
    slideOrder: ['sld_1'],
    elements: { el_chart: chart },
  } as unknown as Ppt4aiDocument
}
function errorsFor(chart: unknown): string[] {
  const result = validateDocument(documentWithChart(chart))
  return result.valid ? [] : result.errors
}

const validChart = { id: 'el_chart', kind: 'chart', bounds: { x: 0, y: 0, w: 100, h: 100 }, chartRelId: 'rId2' }

describe('chart element validation', () => {
  it('accepts a chart with bounds and a chart relationship id', () => {
    expect(errorsFor(validChart)).toEqual([])
  })

  it('accepts optional rotation and flips', () => {
    expect(errorsFor({ ...validChart, rotation: 60000, flipH: true, flipV: false })).toEqual([])
  })

  it('rejects a chart with no chartRelId', () => {
    const { chartRelId, ...noRel } = validChart
    expect(errorsFor(noRel)).toContain('chart element el_chart chartRelId must be a non-empty string')
  })

  it('rejects a chart with an empty chartRelId', () => {
    expect(errorsFor({ ...validChart, chartRelId: '' })).toContain('chart element el_chart chartRelId must be a non-empty string')
  })

  it('rejects a chart with non-positive bounds', () => {
    expect(errorsFor({ ...validChart, bounds: { x: 0, y: 0, w: 0, h: 100 } })).toContain('element el_chart bounds must be positive')
  })

  it('accepts read-only chart data (type, categories, series)', () => {
    expect(errorsFor({
      ...validChart,
      chartType: 'column',
      categories: ['Q1', 'Q2'],
      series: [{ name: 'Revenue', values: [10, null] }, { values: [3, 4], color: { type: 'srgb', v: 'FF0000' } }],
      legend: true,
      dataLabels: false,
    })).toEqual([])
  })

  it('rejects an unknown chart type', () => {
    expect(errorsFor({ ...validChart, chartType: 'radar' })).toContain('chart element el_chart chartType is invalid: radar')
  })

  it('rejects non-string categories', () => {
    expect(errorsFor({ ...validChart, categories: ['ok', 3] })).toContain('chart element el_chart categories must be an array of strings')
  })

  it('rejects series values that are not numbers or null', () => {
    expect(errorsFor({ ...validChart, series: [{ values: [1, 'x'] }] })).toContain('chart element el_chart series[0].values must be numbers or null')
  })
})

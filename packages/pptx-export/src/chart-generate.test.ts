import type { ChartElement } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { serializeChartSpace, serializeChartWorkbook } from './chart-generate.js'
import { readZipEntries } from './zip.js'

const chart = (overrides: Partial<ChartElement> = {}): ChartElement => ({
  id: 'el_1', kind: 'chart', bounds: { x: 0, y: 0, w: 100, h: 100 }, chartRelId: 'rId1',
  chartType: 'column', categories: ['A', 'B'], series: [{ name: 'S1', values: [10, 20] }],
  ...overrides,
})

describe('serializeChartSpace', () => {
  it('emits a column barChart with cached categories, values and workbook formulas', () => {
    const xml = serializeChartSpace(chart())
    expect(xml).toContain('<c:barChart>')
    expect(xml).toContain('<c:barDir val="col"/>')
    expect(xml).toContain('<c:f>Sheet1!$A$2:$A$3</c:f>')
    expect(xml).toContain('<c:f>Sheet1!$B$2:$B$3</c:f>')
    expect(xml).toContain('<c:pt idx="1"><c:v>B</c:v></c:pt>') // category cache
    expect(xml).toContain('<c:pt idx="1"><c:v>20</c:v></c:pt>') // value cache
    expect(xml).toContain('<c:externalData r:id="rId1">')
  })

  it('emits a pieChart with no bar direction or axes', () => {
    const xml = serializeChartSpace(chart({ chartType: 'pie' }))
    expect(xml).toContain('<c:pieChart>')
    expect(xml).not.toContain('barDir')
    expect(xml).not.toContain('<c:catAx>')
  })
})

describe('serializeChartWorkbook', () => {
  it('builds a readable xlsx whose cells match the chart data', async () => {
    const inner = await readZipEntries(serializeChartWorkbook(chart()))
    const sheet = new TextDecoder().decode(inner.find((entry) => entry.name === 'xl/worksheets/sheet1.xml')!.data)
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t>A</t></is></c>')
    expect(sheet).toContain('<c r="B3"><v>20</v></c>')
    expect(inner.some((entry) => entry.name === 'xl/workbook.xml')).toBe(true)
  })
})

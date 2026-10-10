import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

// A slide with a plain shape (el_1) followed by a chart graphicFrame (which burns the el_2 slot). The
// chart is dropped from the model today, but its part and its graphicFrame must survive import→export
// untouched, and editing the sibling shape must not shift the chart. This test is the Phase 0 guardrail:
// it pins that preservation before the importer/writeback start treating the chart as a real element.
const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

const CHART_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const CHART_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart'

const slide = '<p:sld xmlns:p="p" xmlns:a="a" xmlns:c="c" xmlns:r="r"><p:cSld><p:spTree>'
  + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Filled"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
  + '<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></p:spPr></p:sp>'
  + '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Chart 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
  + '<p:xfrm><a:off x="7000000" y="1000000"/><a:ext cx="4000000" cy="3000000"/></p:xfrm>'
  + `<a:graphic><a:graphicData uri="${CHART_URI}"><c:chart r:id="rId1"/></a:graphicData></a:graphic>`
  + '</p:graphicFrame>'
  + '</p:spTree></p:cSld></p:sld>'
const slideRels = `<Relationships xmlns="r"><Relationship Id="rId1" Type="${CHART_REL_TYPE}" Target="../charts/chart1.xml"/></Relationships>`
const chartXml = '<c:chartSpace xmlns:c="c"><c:chart><c:plotArea><c:barChart/></c:plotArea></c:chart></c:chartSpace>'
const chartXmlWithData = '<c:chartSpace xmlns:c="c"><c:chart><c:plotArea><c:barChart>'
  + '<c:ser><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>'
  + '<c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>'
  + '</c:barChart></c:plotArea></c:chart></c:chartSpace>'

function source(chartPart: string = chartXml): Uint8Array {
  const encode = (value: string): Uint8Array => new TextEncoder().encode(value)
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: encode(slide) },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: encode(slideRels) },
    { name: 'ppt/charts/chart1.xml', data: encode(chartPart) },
  ])
}

async function entriesOf(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  return new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
}
async function slideXmlOf(bytes: Uint8Array): Promise<string> {
  const data = (await entriesOf(bytes)).get('ppt/slides/slide1.xml')
  if (!data) throw new Error('missing slide')
  return new TextDecoder().decode(data)
}

describe('Phase 0 guardrail: a chart survives import → edit → export', () => {
  it('imports the sibling shape at el_1 and the chart at el_2', async () => {
    const document = await importPptx(source())
    expect(document.elements.el_1?.kind).toBe('shape')
    expect(document.elements.el_2?.kind).toBe('chart')
  })

  it('preserves the chart part and graphicFrame when the sibling shape is edited', async () => {
    const src = source()
    const document = await importPptx(src)
    const shape = document.elements.el_1
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    shape.fill = { color: { type: 'srgb', v: 'FF0000' } }

    const out = await exportPptx(document, src)
    const slideXml = await slideXmlOf(out)
    expect(slideXml).toContain('<a:srgbClr val="FF0000"/>') // the edit landed on the shape
    expect(slideXml).toContain(`<a:graphicData uri="${CHART_URI}">`) // chart frame survived
    expect(slideXml).toContain('<c:chart r:id="rId1"/>') // unshifted, same relationship
    expect((await entriesOf(out)).has('ppt/charts/chart1.xml')).toBe(true) // chart part carried
  })

  it('leaves the whole package byte-identical when nothing is edited', async () => {
    const src = source()
    expect(await exportPptx(await importPptx(src), src)).toEqual(src)
  })

  it('patches the frame box when the chart itself is moved, keeping the chart part', async () => {
    const src = source()
    const document = await importPptx(src)
    const chart = document.elements.el_2
    if (chart?.kind !== 'chart') throw new Error('fixture chart did not import')
    chart.bounds = { ...chart.bounds, x: 500000, y: 600000 }

    const out = await exportPptx(document, src)
    const slideXml = await slideXmlOf(out)
    expect(slideXml).toContain('<a:off x="500000" y="600000"/>') // frame box moved
    expect(slideXml).toContain('<c:chart r:id="rId1"/>') // reference untouched
    expect((await entriesOf(out)).has('ppt/charts/chart1.xml')).toBe(true) // part carried
  })

  it('writes edited chart values and categories back into the chart part cache (Tier A round-trip)', async () => {
    const src = source(chartXmlWithData)
    const document = await importPptx(src)
    const chart = document.elements.el_2
    if (chart?.kind !== 'chart' || !chart.series?.[0]) throw new Error('fixture chart did not import with data')
    chart.series = [{ ...chart.series[0], values: [10, 99] }]
    chart.categories = ['A', 'Z']

    const reimported = await importPptx(await exportPptx(document, src))
    const chart2 = reimported.elements.el_2
    expect(chart2?.kind === 'chart' ? chart2.series?.[0]?.values : undefined).toEqual([10, 99])
    expect(chart2?.kind === 'chart' ? chart2.categories : undefined).toEqual(['A', 'Z'])
  })

  it('syncs edited values into the embedded workbook via c:f, keeping cache and workbook in step (Tier B)', async () => {
    const enc = (value: string): Uint8Array => new TextEncoder().encode(value)
    const embeddedXlsx = writeStoredZip([
      { name: 'xl/workbook.xml', data: enc('<workbook xmlns:r="r"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>') },
      { name: 'xl/_rels/workbook.xml.rels', data: enc('<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>') },
      { name: 'xl/worksheets/sheet1.xml', data: enc('<worksheet><sheetData><row r="2"><c r="B2"><v>10</v></c></row><row r="3"><c r="B3"><v>20</v></c></row></sheetData></worksheet>') },
    ])
    const chartPart = '<c:chartSpace xmlns:c="c" xmlns:r="r"><c:chart><c:plotArea><c:barChart>'
      + '<c:ser><c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>'
      + '</c:barChart></c:plotArea></c:chart><c:externalData r:id="rId1"/></c:chartSpace>'
    const chartPartRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../embeddings/wb.xlsx"/></Relationships>'
    const src = writeStoredZip([
      { name: 'ppt/presentation.xml', data: enc(presentation) },
      { name: 'ppt/_rels/presentation.xml.rels', data: enc(presentationRels) },
      { name: 'ppt/slides/slide1.xml', data: enc(slide) },
      { name: 'ppt/slides/_rels/slide1.xml.rels', data: enc(slideRels) },
      { name: 'ppt/charts/chart1.xml', data: enc(chartPart) },
      { name: 'ppt/charts/_rels/chart1.xml.rels', data: enc(chartPartRels) },
      { name: 'ppt/embeddings/wb.xlsx', data: embeddedXlsx },
    ])

    const document = await importPptx(src)
    const chart = document.elements.el_2
    if (chart?.kind !== 'chart' || !chart.series?.[0]) throw new Error('fixture chart did not import with data')
    chart.series = [{ ...chart.series[0], values: [10, 99] }]

    const out = await exportPptx(document, src)
    const xlsxBytes = (await entriesOf(out)).get('ppt/embeddings/wb.xlsx')
    if (!xlsxBytes) throw new Error('embedded workbook missing from output')
    const sheetXml = new TextDecoder().decode((await readZipEntries(xlsxBytes)).find((entry) => entry.name === 'xl/worksheets/sheet1.xml')!.data)
    expect(sheetXml).toContain('<v>99</v>') // B3 updated in the workbook
    expect(sheetXml).toContain('<v>10</v>') // B2 left as-is
    // Cache stays in step with the workbook.
    const reimported = await importPptx(out)
    expect(reimported.elements.el_2?.kind === 'chart' ? reimported.elements.el_2.series?.[0]?.values : undefined).toEqual([10, 99])
  })
})

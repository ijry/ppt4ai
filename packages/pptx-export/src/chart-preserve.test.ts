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

function source(): Uint8Array {
  const encode = (value: string): Uint8Array => new TextEncoder().encode(value)
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: encode(slide) },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: encode(slideRels) },
    { name: 'ppt/charts/chart1.xml', data: encode(chartXml) },
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
  // Documents current behaviour; this assertion flips when the importer starts keeping charts (step 3).
  it('drops the chart from the model today, keeping the sibling shape at el_1', async () => {
    const document = await importPptx(source())
    expect(document.elements.el_1?.kind).toBe('shape')
    expect(document.elements.el_2).toBeUndefined()
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
})

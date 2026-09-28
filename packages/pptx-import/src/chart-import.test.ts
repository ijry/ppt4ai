import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

const CHART_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const CHART_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart'

// A slide rels sidecar that keeps the layout link and adds the chart-part relationship the frame names.
const chartRels = '<Relationships xmlns="r">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>'
  + `<Relationship Id="rId7" Type="${CHART_REL_TYPE}" Target="../charts/chart1.xml"/>`
  + '</Relationships>'

// A clustered column chart part: two series over two categories; the second series carries a colour.
const chartPart = '<c:chartSpace xmlns:c="c" xmlns:a="a"><c:chart><c:plotArea><c:barChart>'
  + '<c:barDir val="col"/><c:grouping val="clustered"/>'
  + '<c:ser><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>Revenue</c:v></c:pt></c:strCache></c:strRef></c:tx>'
  + '<c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strCache></c:strRef></c:cat>'
  + '<c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>'
  + '<c:ser><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>Cost</c:v></c:pt></c:strCache></c:strRef></c:tx>'
  + '<c:spPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></c:spPr>'
  + '<c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>3</c:v></c:pt><c:pt idx="1"><c:v>4</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>'
  + '</c:barChart></c:plotArea><c:legend/></c:chart></c:chartSpace>'

// A graphicFrame whose graphicData holds a <c:chart r:id> — the shape a PowerPoint chart takes on a slide.
const chartSlide = (attributes = ''): string => '<p:sld xmlns:p="p" xmlns:a="a" xmlns:c="c" xmlns:r="r"><p:cSld><p:spTree>'
  + '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Chart 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
  + `<p:xfrm${attributes}><a:off x="7000000" y="1000000"/><a:ext cx="4000000" cy="3000000"/></p:xfrm>`
  + `<a:graphic><a:graphicData uri="${CHART_URI}"><c:chart r:id="rId7"/></a:graphicData></a:graphic>`
  + '</p:graphicFrame></p:spTree></p:cSld></p:sld>'

async function firstElement(slideXml: string, id = 'el_1'): Promise<unknown> {
  const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': slideXml }))
  return document.elements[id]
}

describe('chart import', () => {
  it('imports a chart graphicFrame as a chart element with bounds and the relationship id', async () => {
    expect(await firstElement(chartSlide())).toMatchObject({
      kind: 'chart',
      bounds: { x: 7000000, y: 1000000, w: 4000000, h: 3000000 },
      chartRelId: 'rId7',
    })
  })

  it('reads rotation and flips on a chart frame', async () => {
    expect(await firstElement(chartSlide(' rot="2700000" flipH="1"'))).toMatchObject({
      kind: 'chart',
      rotation: 2700000,
      flipH: true,
    })
  })

  it('reflects the chart part cache: type, categories, series, colour and legend', async () => {
    const document = await importPptx(createStoredZip({
      ...files,
      'ppt/slides/slide1.xml': chartSlide(),
      'ppt/slides/_rels/slide1.xml.rels': chartRels,
      'ppt/charts/chart1.xml': chartPart,
    }))
    expect(document.elements.el_1).toMatchObject({
      kind: 'chart',
      chartType: 'column',
      categories: ['Q1', 'Q2'],
      series: [
        { name: 'Revenue', values: [10, 20] },
        { name: 'Cost', values: [3, 4], color: { type: 'srgb', v: 'FF0000' } },
      ],
      legend: true,
    })
  })

  it('keeps the placeholder (no data) when the chart part cannot be reached', async () => {
    const element = await firstElement(chartSlide()) as Record<string, unknown>
    expect(element).toMatchObject({ kind: 'chart', chartRelId: 'rId7' })
    expect(element).not.toHaveProperty('series')
  })
})

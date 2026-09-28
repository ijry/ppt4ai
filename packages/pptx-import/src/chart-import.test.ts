import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

const CHART_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart'

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
})

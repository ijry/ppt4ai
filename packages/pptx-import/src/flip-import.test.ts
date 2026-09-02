import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

const shapeSlide = (attributes: string) => '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
  + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Shape"/><p:nvPr/></p:nvSpPr>'
  + `<p:spPr><a:xfrm${attributes}><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:sp>`
  + '</p:spTree></p:cSld></p:sld>'

const textSlide = (attributes: string) => '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
  + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/><p:nvPr/></p:nvSpPr>'
  + `<p:spPr><a:xfrm${attributes}><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm></p:spPr>`
  + '<p:txBody><a:p><a:r><a:t>Mirrored</a:t></a:r></a:p></p:txBody></p:sp>'
  + '</p:spTree></p:cSld></p:sld>'

const tableSlide = (attributes: string) => '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
  + '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
  + `<p:xfrm${attributes}><a:off x="4000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></p:xfrm>`
  + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">'
  + '<a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="2000000"/></a:tblGrid>'
  + '<a:tr h="1000000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Cell</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl>'
  + '</a:graphicData></a:graphic></p:graphicFrame>'
  + '</p:spTree></p:cSld></p:sld>'

const groupSlide = (attributes: string) => '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
  + '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="10" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
  + `<p:grpSpPr><a:xfrm${attributes}><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:grpSpPr>`
  + '<p:sp><p:nvSpPr><p:cNvPr id="11" name="Inner"/><p:nvPr/></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="1000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:sp>'
  + '</p:grpSp></p:spTree></p:cSld></p:sld>'

async function firstElement(slideXml: string, id = 'el_1') {
  const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': slideXml }))
  return document.elements[id]
}

describe('flip import for non-image elements', () => {
  it('reads flipH and flipV on a shape', async () => {
    expect(await firstElement(shapeSlide(' flipH="1" flipV="1"'))).toMatchObject({ kind: 'shape', flipH: true, flipV: true })
  })

  it('reads flipH alone on a shape', async () => {
    const element = await firstElement(shapeSlide(' flipH="1"'))

    expect(element).toMatchObject({ flipH: true })
    expect(element).not.toHaveProperty('flipV')
  })

  it('omits flips that are absent', async () => {
    const element = await firstElement(shapeSlide(''))

    expect(element).not.toHaveProperty('flipH')
    expect(element).not.toHaveProperty('flipV')
  })

  it('treats an explicit zero as no flip rather than storing false', async () => {
    const element = await firstElement(shapeSlide(' flipH="0" flipV="0"'))

    expect(element).not.toHaveProperty('flipH')
    expect(element).not.toHaveProperty('flipV')
  })

  it('reads flips on a text element', async () => {
    expect(await firstElement(textSlide(' flipV="1"'))).toMatchObject({ kind: 'text', flipV: true })
  })

  it('reads flips on a table frame', async () => {
    expect(await firstElement(tableSlide(' flipH="1"'))).toMatchObject({ kind: 'table', flipH: true })
  })

  it('reads flips on a group', async () => {
    const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': groupSlide(' flipH="1"') }))

    expect(document.elements.grp_1).toMatchObject({ kind: 'group', flipH: true })
  })

  it('keeps rotation and flips together', async () => {
    expect(await firstElement(shapeSlide(' rot="2700000" flipH="1"'))).toMatchObject({ rotation: 2700000, flipH: true })
  })
})

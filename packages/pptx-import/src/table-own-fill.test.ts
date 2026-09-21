import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

function tableSlide(tableProperties: string): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
    + '<p:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></p:xfrm>'
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">'
    + `<a:tbl><a:tblPr>${tableProperties}</a:tblPr><a:tblGrid><a:gridCol w="2000000"/></a:tblGrid>`
    + '<a:tr h="1000000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Cell</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl>'
    + '</a:graphicData></a:graphic></p:graphicFrame>'
    + '</p:spTree></p:cSld></p:sld>'
}

async function tableFill(tableProperties: string) {
  const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': tableSlide(tableProperties) }))
  const element = document.elements.el_1
  if (element?.kind !== 'table') throw new Error('fixture did not import as a table')
  return element.fill
}

describe('table own pattern and gradient fill on import', () => {
  /** Before this the table fill used the solid-only parser, so an a:pattFill table fill was dropped. */
  it('reads a table pattern fill, mirroring the foreground into the fill colour', async () => {
    expect(await tableFill(
      '<a:pattFill prst="ltHorz"><a:fgClr><a:srgbClr val="FF0000"/></a:fgClr>'
      + '<a:bgClr><a:srgbClr val="00FF00"/></a:bgClr></a:pattFill>',
    )).toEqual({
      color: { type: 'srgb', v: 'FF0000' },
      pattern: { preset: 'ltHorz', foreground: { type: 'srgb', v: 'FF0000' }, background: { type: 'srgb', v: '00FF00' } },
    })
  })

  it('reads a table gradient fill', async () => {
    const fill = await tableFill(
      '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="4472C4"/></a:gs>'
      + '<a:gs pos="100000"><a:srgbClr val="203864"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill>',
    )
    expect(fill?.gradient?.stops).toHaveLength(2)
  })

  it('still reads a plain solid table fill', async () => {
    expect(await tableFill('<a:solidFill><a:srgbClr val="1F3864"/></a:solidFill>')).toEqual({ color: { type: 'srgb', v: '1F3864' } })
  })
})

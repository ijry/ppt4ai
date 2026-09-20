import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

function tableSlide(cellProperties: string): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
    + '<p:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></p:xfrm>'
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">'
    + '<a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="2000000"/></a:tblGrid>'
    + `<a:tr h="1000000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Cell</a:t></a:r></a:p></a:txBody><a:tcPr>${cellProperties}</a:tcPr></a:tc></a:tr></a:tbl>`
    + '</a:graphicData></a:graphic></p:graphicFrame>'
    + '</p:spTree></p:cSld></p:sld>'
}

async function cellFill(cellProperties: string) {
  const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': tableSlide(cellProperties) }))
  const element = document.elements.el_1
  if (element?.kind !== 'table') throw new Error('fixture did not import as a table')
  return element.rows[0]?.cells[0]?.fill
}

describe('table cell pattern fill on import', () => {
  /** Before this a cell used the solid-only parser, so an a:pattFill cell fill was dropped entirely. */
  it('reads the preset and both colours, mirroring the foreground into the fill colour', async () => {
    expect(await cellFill(
      '<a:pattFill prst="ltHorz"><a:fgClr><a:srgbClr val="FF0000"/></a:fgClr>'
      + '<a:bgClr><a:srgbClr val="00FF00"/></a:bgClr></a:pattFill>',
    )).toEqual({
      color: { type: 'srgb', v: 'FF0000' },
      pattern: {
        preset: 'ltHorz',
        foreground: { type: 'srgb', v: 'FF0000' },
        background: { type: 'srgb', v: '00FF00' },
      },
    })
  })

  it('still reads a plain solid cell fill', async () => {
    expect(await cellFill('<a:solidFill><a:srgbClr val="1F3864"/></a:solidFill>')).toEqual({
      color: { type: 'srgb', v: '1F3864' },
    })
  })

  it('leaves a cell without a fill unset', async () => {
    expect(await cellFill('')).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

const diagonal = '<a:lnTlToBr w="12700"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:lnTlToBr>'
  + '<a:lnBlToTr w="6350"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill><a:prstDash val="dash"/></a:lnBlToTr>'

function tableSlide(cellProperties: string): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
    + '<p:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></p:xfrm>'
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">'
    + '<a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="2000000"/></a:tblGrid>'
    + `<a:tr h="1000000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Split</a:t></a:r></a:p></a:txBody><a:tcPr>${cellProperties}</a:tcPr></a:tc></a:tr></a:tbl>`
    + '</a:graphicData></a:graphic></p:graphicFrame>'
    + '</p:spTree></p:cSld></p:sld>'
}

async function cellBorders(cellProperties: string) {
  const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': tableSlide(cellProperties) }))
  const element = document.elements.el_1
  if (element?.kind !== 'table') throw new Error('fixture did not import as a table')
  return element.rows[0]?.cells[0]?.borders
}

async function styleBorders(styleBorders: string) {
  const styleXml = '<a:tblStyleLst xmlns:a="a" def="style-1"><a:tblStyle styleId="style-1" styleName="Diagonals">'
    + `<a:wholeTbl><a:tcStyle><a:tcBdr>${styleBorders}</a:tcBdr></a:tcStyle></a:wholeTbl>`
    + '</a:tblStyle></a:tblStyleLst>'
  const document = await importPptx(createStoredZip({ ...files, 'ppt/tableStyles.xml': styleXml }))
  return document.tableStyles?.['style-1']?.regions?.wholeTable?.borders
}

describe('cell diagonal borders', () => {
  it('reads both diagonals from a cell', async () => {
    expect(await cellBorders(diagonal)).toEqual({
      tlToBr: { color: { type: 'srgb', v: 'FF0000' }, width: 12700, style: 'solid' },
      blToTr: { color: { type: 'srgb', v: '00FF00' }, width: 6350, style: 'dash' },
    })
  })

  it('keeps the four sides alongside them', async () => {
    const borders = await cellBorders(`<a:lnL w="1000"><a:solidFill><a:srgbClr val="111111"/></a:solidFill></a:lnL>${diagonal}`)

    expect(Object.keys(borders ?? {}).sort()).toEqual(['blToTr', 'left', 'tlToBr'])
  })

  /** A style names the same pair `tl2br`/`tr2bl`; the model keeps one pair of field names for both. */
  it('reads a style\'s diagonals into the same fields', async () => {
    expect(await styleBorders('<a:tl2br><a:ln w="12700"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></a:tl2br>'
      + '<a:tr2bl><a:ln><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:ln></a:tr2bl>')).toEqual({
      tlToBr: { color: { type: 'srgb', v: 'FF0000' }, width: 12700, style: 'solid' },
      blToTr: { color: { type: 'srgb', v: '00FF00' }, style: 'solid' },
    })
  })

  /**
   * A cell border with an unusable `w` keeps its colour and drops only the width — `parseTableBorder`'s
   * long-standing rule, and different from a style border, which the style parser discards whole. The
   * diagonals inherit whichever rule their side of the fence already had.
   */
  it('keeps a diagonal whose width is unusable and drops only the width', async () => {
    expect(await cellBorders('<a:lnTlToBr w="thick"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:lnTlToBr>'))
      .toEqual({ tlToBr: { color: { type: 'srgb', v: 'FF0000' }, style: 'solid' } })
    expect(await styleBorders('<a:tl2br><a:ln w="thick"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></a:tl2br>'))
      .toBeUndefined()
  })

  it('drops a diagonal with no colour at all', async () => {
    expect(await cellBorders('<a:lnTlToBr w="12700"/>')).toBeUndefined()
  })
})

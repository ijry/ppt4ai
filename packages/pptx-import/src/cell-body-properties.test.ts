import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

function tableSlide(cellProperties: string): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
    + '<p:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></p:xfrm>'
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">'
    + '<a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="2000000"/></a:tblGrid>'
    + `<a:tr h="1000000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Cell</a:t></a:r></a:p></a:txBody><a:tcPr ${cellProperties}/></a:tc></a:tr></a:tbl>`
    + '</a:graphicData></a:graphic></p:graphicFrame>'
    + '</p:spTree></p:cSld></p:sld>'
}

async function cellBodyPr(cellProperties: string) {
  const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': tableSlide(cellProperties) }))
  const element = document.elements.el_1
  if (element?.kind !== 'table') throw new Error('fixture did not import as a table')
  return element.rows[0]?.cells[0]?.cellBodyPr
}

describe('cell body properties', () => {
  /** OOXML puts a cell's margins and anchor on `a:tcPr`, not on the cell's own `a:bodyPr`. */
  it('reads the four margins and the anchor from a:tcPr', async () => {
    expect(await cellBodyPr('marL="91440" marT="45720" marR="91440" marB="45720" anchor="ctr"')).toEqual({
      insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 },
      verticalAlign: 'middle',
    })
  })

  it('maps the three anchor words', async () => {
    expect((await cellBodyPr('anchor="t"'))?.verticalAlign).toBe('top')
    expect((await cellBodyPr('anchor="ctr"'))?.verticalAlign).toBe('middle')
    expect((await cellBodyPr('anchor="b"'))?.verticalAlign).toBe('bottom')
  })

  /** `anchor` absent means `t`, which is what the layout already does — so nothing is recorded. */
  it('records nothing for a cell that states neither', async () => {
    expect(await cellBodyPr('')).toBeUndefined()
    expect(await cellBodyPr('gridSpan="1"')).toBeUndefined()
  })

  /** All four or none, the rule `parseBodyProperties` already follows: the model has no partial form. */
  it('ignores a partial or negative margin set', async () => {
    expect(await cellBodyPr('marL="91440"')).toBeUndefined()
    expect(await cellBodyPr('marL="-1" marT="0" marR="0" marB="0"')).toBeUndefined()
    expect(await cellBodyPr('marL="0" marT="0" marR="0" marB="0" anchor="b"')).toEqual({
      insets: { left: 0, top: 0, right: 0, bottom: 0 },
      verticalAlign: 'bottom',
    })
  })

  it('keeps the cell\'s own bodyPr separate from the tcPr framing', async () => {
    const document = await importPptx(createStoredZip({
      ...files,
      'ppt/slides/slide1.xml': tableSlide('anchor="b"').replace('<a:bodyPr/>', '<a:bodyPr anchor="ctr"/>'),
    }))
    const element = document.elements.el_1
    if (element?.kind !== 'table') throw new Error('fixture did not import as a table')

    expect(element.rows[0]?.cells[0]?.cellBodyPr?.verticalAlign).toBe('bottom')
    expect(element.rows[0]?.cells[0]?.body.bodyPr?.verticalAlign).toBe('middle')
  })
})

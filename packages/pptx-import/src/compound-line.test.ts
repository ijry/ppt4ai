import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

const masterRelationships = '<Relationships xmlns="r"><Relationship Id="rIdTheme"'
  + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"'
  + ' Target="../theme/theme1.xml"/></Relationships>'
const navy = '<a:solidFill><a:srgbClr val="203864"/></a:solidFill>'

function slideWith(line: string): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Bordered"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `<a:prstGeom prst="rect"/>${line}</p:spPr>`
    + '</p:sp></p:spTree></p:cSld></p:sld>'
}

async function shapeOf(line: string) {
  const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': slideWith(line) }))
  const shape = document.elements.el_1
  if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
  return shape
}

async function themeEntry(lineXml: string) {
  const theme = '<a:theme xmlns:a="a" name="Office"><a:themeElements>'
    + '<a:clrScheme name="Office"><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme>'
    + `<a:fmtScheme name="Office"><a:fillStyleLst/><a:lnStyleLst>${lineXml}</a:lnStyleLst>`
    + '<a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme>'
    + '</a:themeElements></a:theme>'
  const document = await importPptx(createStoredZip({
    ...files,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': masterRelationships,
    'ppt/theme/theme1.xml': theme,
  }))
  return Object.values(document.themes ?? {})[0]?.formatScheme?.lineStyles?.[0]
}

describe('compound line and stroke alignment on import', () => {
  /** Before this both attributes were dropped, so a sourceless export rewrote dbl as a single line. */
  it('reads every compound token', async () => {
    for (const token of ['sng', 'dbl', 'thickThin', 'thinThick', 'tri'] as const) {
      const shape = await shapeOf(`<a:ln w="76200" cmpd="${token}">${navy}</a:ln>`)

      expect(shape.strokeCompound, token).toBe(token)
    }
  })

  it('reads both alignment tokens', async () => {
    expect((await shapeOf(`<a:ln w="76200" algn="ctr">${navy}</a:ln>`)).strokeAlign).toBe('ctr')
    expect((await shapeOf(`<a:ln w="76200" algn="in">${navy}</a:ln>`)).strokeAlign).toBe('in')
  })

  /** An unknown word stays out of the model rather than failing the import, as elsewhere. */
  it('ignores a word it does not recognise', async () => {
    const shape = await shapeOf(`<a:ln w="76200" cmpd="quadruple" algn="outside">${navy}</a:ln>`)

    expect(shape.strokeCompound).toBeUndefined()
    expect(shape.strokeAlign).toBeUndefined()
  })

  it('leaves both absent when the line says nothing', async () => {
    const shape = await shapeOf(`<a:ln w="76200">${navy}</a:ln>`)

    expect(shape.strokeCompound).toBeUndefined()
    expect(shape.strokeAlign).toBeUndefined()
  })

  it('reads them on a theme line style entry too', async () => {
    expect(await themeEntry(`<a:ln w="6350" cmpd="thickThin" algn="in">${navy}</a:ln>`))
      .toEqual({ color: { type: 'srgb', v: '203864' }, width: 6350, compound: 'thickThin', align: 'in' })
  })
})

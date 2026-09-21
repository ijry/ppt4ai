import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

const masterRelationships = '<Relationships xmlns="r"><Relationship Id="rIdTheme"'
  + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"'
  + ' Target="../theme/theme1.xml"/></Relationships>'
const navy = '<a:solidFill><a:srgbClr val="203864"/></a:solidFill>'

function slideWith(line: string): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Mitred"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `<a:prstGeom prst="rect"/>${line}</p:spPr>`
    + '</p:sp></p:spTree></p:cSld></p:sld>'
}

async function limitOf(line: string) {
  const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': slideWith(line) }))
  const shape = document.elements.el_1
  if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
  return shape.strokeMiterLimit
}

describe('miter limit on import', () => {
  it('reads the limit off the corner element', async () => {
    expect(await limitOf(`<a:ln w="76200">${navy}<a:miter lim="800000"/></a:ln>`)).toBe(800000)
  })

  it('leaves the field absent for a bare corner', async () => {
    expect(await limitOf(`<a:ln w="76200">${navy}<a:miter/></a:ln>`)).toBeUndefined()
  })

  /** Only `a:miter` carries the attribute, so the other two corners never produce one. */
  it('leaves the field absent for a rounded or bevelled corner', async () => {
    expect(await limitOf(`<a:ln w="76200">${navy}<a:round/></a:ln>`)).toBeUndefined()
    expect(await limitOf(`<a:ln w="76200">${navy}<a:bevel/></a:ln>`)).toBeUndefined()
  })

  /** An unusable value is ignored rather than stored, the rule `parseLineWidth` follows. */
  it('ignores a value that is not a positive number', async () => {
    expect(await limitOf(`<a:ln w="76200">${navy}<a:miter lim="0"/></a:ln>`)).toBeUndefined()
    expect(await limitOf(`<a:ln w="76200">${navy}<a:miter lim="-5"/></a:ln>`)).toBeUndefined()
    expect(await limitOf(`<a:ln w="76200">${navy}<a:miter lim="sharp"/></a:ln>`)).toBeUndefined()
  })

  it('reads it on a theme line style entry too', async () => {
    const theme = '<a:theme xmlns:a="a" name="Office"><a:themeElements>'
      + '<a:clrScheme name="Office"><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme>'
      + '<a:fmtScheme name="Office"><a:fillStyleLst/>'
      + `<a:lnStyleLst><a:ln w="6350">${navy}<a:miter lim="500000"/></a:ln></a:lnStyleLst>`
      + '<a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme>'
      + '</a:themeElements></a:theme>'
    const document = await importPptx(createStoredZip({
      ...files,
      'ppt/slideMasters/_rels/slideMaster1.xml.rels': masterRelationships,
      'ppt/theme/theme1.xml': theme,
    }))

    expect(Object.values(document.themes ?? {})[0]?.formatScheme?.lineStyles?.[0])
      .toEqual({ color: { type: 'srgb', v: '203864' }, width: 6350, join: 'miter', miterLimit: 500000 })
  })
})

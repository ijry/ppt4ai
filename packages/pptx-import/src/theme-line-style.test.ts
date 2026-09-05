import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

const masterRelationships = '<Relationships xmlns="r"><Relationship Id="rIdTheme"'
  + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"'
  + ' Target="../theme/theme1.xml"/></Relationships>'

function themeWith(lineStyleList: string): string {
  return '<a:theme xmlns:a="a" name="Office"><a:themeElements>'
    + '<a:clrScheme name="Office"><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme>'
    + '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
    + `<a:lnStyleLst>${lineStyleList}</a:lnStyleLst>`
    + '<a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme>'
    + '</a:themeElements></a:theme>'
}

const phFill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'

async function lineStyles(lineStyleList: string) {
  const document = await importPptx(createStoredZip({
    ...files,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': masterRelationships,
    'ppt/theme/theme1.xml': themeWith(lineStyleList),
  }))
  return Object.values(document.themes ?? {})[0]?.formatScheme?.lineStyles
}

describe('theme line styles on import', () => {
  /** Before this, three entries differing in `w` and `prstDash` produced byte-identical records. */
  it('reads the width and dash of each entry', async () => {
    const entries = await lineStyles(
      `<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr">${phFill}<a:prstDash val="solid"/></a:ln>`
      + `<a:ln w="12700" cap="flat">${phFill}<a:prstDash val="dash"/></a:ln>`
      + `<a:ln w="19050">${phFill}<a:prstDash val="sysDot"/></a:ln>`,
    )

    expect(entries).toEqual([
      { color: { type: 'scheme', v: 'phClr' }, width: 6350, cap: 'flat' },
      { color: { type: 'scheme', v: 'phClr' }, width: 12700, style: 'dash', cap: 'flat' },
      { color: { type: 'scheme', v: 'phClr' }, width: 19050, style: 'sysDot' },
    ])
  })

  /** Same rule the element stroke follows: `solid` is the default, so it stays out of the model. */
  it('omits the fields the entry does not declare', async () => {
    expect(await lineStyles(`<a:ln>${phFill}</a:ln>`)).toEqual([{ color: { type: 'scheme', v: 'phClr' } }])
    expect(await lineStyles(`<a:ln w="6350">${phFill}<a:prstDash val="solid"/></a:ln>`))
      .toEqual([{ color: { type: 'scheme', v: 'phClr' }, width: 6350 }])
  })

  it('ignores an unusable width', async () => {
    expect(await lineStyles(`<a:ln w="thick">${phFill}</a:ln>`)).toEqual([{ color: { type: 'scheme', v: 'phClr' } }])
    expect(await lineStyles(`<a:ln w="-5">${phFill}</a:ln>`)).toEqual([{ color: { type: 'scheme', v: 'phClr' } }])
  })

  /** A gradient line entry stays `null`, so there is no record to hang a width on. */
  it('nulls an entry it cannot express, width and all', async () => {
    const entries = await lineStyles(
      '<a:ln w="12700"><a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs></a:gsLst></a:gradFill></a:ln>',
    )

    expect(entries).toEqual([null])
  })

  it('leaves fill and background entries as plain fills', async () => {
    const document = await importPptx(createStoredZip({
      ...files,
      'ppt/slideMasters/_rels/slideMaster1.xml.rels': masterRelationships,
      'ppt/theme/theme1.xml': themeWith(`<a:ln w="6350">${phFill}</a:ln>`),
    }))
    const formatScheme = Object.values(document.themes ?? {})[0]?.formatScheme

    expect(formatScheme?.fillStyles).toEqual([{ color: { type: 'scheme', v: 'phClr' } }])
  })
})

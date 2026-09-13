import type { Fill } from '@ppt4ai/model'
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
      { color: { type: 'scheme', v: 'phClr' }, width: 6350, cap: 'flat', compound: 'sng', align: 'ctr' },
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

  /** A gradient with neither a:lin nor a:path is still unreadable, regardless of its line width. */
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

const gradientFillXml = '<a:gradFill rotWithShape="1"><a:gsLst>'
  + '<a:gs pos="0"><a:schemeClr val="phClr"><a:satMod val="150000"/></a:schemeClr></a:gs>'
  + '<a:gs pos="100000"><a:sysClr val="window" lastClr="FFFFFF"><a:alpha val="45000"/></a:sysClr></a:gs>'
  + '</a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>'
const gradientFill: Fill = {
  color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'satMod', value: 150000 }] },
  gradient: {
    stops: [
      { pos: 0, color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'satMod', value: 150000 }] } },
      { pos: 100000, color: { type: 'system', v: 'FFFFFF', systemName: 'window', transforms: [{ type: 'alpha', value: 45000 }] } },
    ],
    angle: 5400000,
    scaled: false,
  },
}
const patternFillXml = '<a:pattFill prst="pct10"><a:fgClr><a:schemeClr val="phClr"/></a:fgClr>'
  + '<a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill>'
const patternFill: Fill = {
  color: { type: 'scheme', v: 'phClr' },
  pattern: {
    preset: 'pct10',
    foreground: { type: 'scheme', v: 'phClr' },
    background: { type: 'srgb', v: 'FFFFFF' },
  },
}

describe('theme lines keep every supported fill kind', () => {
  // Reading only solidFill turns this whole entry into null, losing geometry as well as its fill.
  it('keeps a linear gradient together with all declared line properties', async () => {
    const entries = await lineStyles('<a:ln w="12700" cap="rnd" cmpd="dbl" algn="in">'
      + gradientFillXml + '<a:prstDash val="lgDashDot"/><a:miter lim="400000"/></a:ln>')

    expect(entries).toEqual([{
      ...gradientFill, width: 12700, style: 'lgDashDot', cap: 'rnd', join: 'miter',
      compound: 'dbl', align: 'in', miterLimit: 400000,
    }])
  })

  it('keeps radial geometry and its fillToRect instead of flattening it', async () => {
    const radial = gradientFillXml.replace('<a:lin ang="5400000" scaled="0"/>',
      '<a:path path="circle"><a:fillToRect l="25000" t="10000" r="25000" b="20000"/></a:path>')

    expect(await lineStyles('<a:ln w="19050" cap="flat">' + radial + '<a:bevel/></a:ln>')).toEqual([{
      color: gradientFill.color,
      gradient: { stops: gradientFill.gradient!.stops, path: 'circle', fillToRect: { left: 25000, top: 10000, right: 25000, bottom: 20000 } },
      width: 19050, cap: 'flat', join: 'bevel',
    }])
  })

  it('keeps a pattern and both colors together with a custom dash', async () => {
    const entries = await lineStyles('<a:ln w="25400" cap="sq" cmpd="thickThin" algn="ctr">'
      + patternFillXml + '<a:custDash><a:ds d="400000" sp="200000"/><a:ds d="100000" sp="300000"/></a:custDash><a:round/></a:ln>')

    expect(entries).toEqual([{
      ...patternFill, width: 25400, cap: 'sq', compound: 'thickThin', align: 'ctr', join: 'round',
      style: { custom: [{ dash: 400000, space: 200000 }, { dash: 100000, space: 300000 }] },
    }])
  })

  it('does not invent line defaults when only a gradient fill is present', async () => {
    expect(await lineStyles('<a:ln>' + gradientFillXml + '</a:ln>')).toEqual([gradientFill])
  })

  it('keeps a one-stop gradient as a plain color without dropping an explicit zero width', async () => {
    const single = '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="112233"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill>'

    expect(await lineStyles('<a:ln w="0">' + single + '<a:bevel/></a:ln>'))
      .toEqual([{ color: { type: 'srgb', v: '112233' }, width: 0, join: 'bevel' }])
  })

  it('ignores unusable line attributes without discarding a valid non-solid fill', async () => {
    const entries = await lineStyles('<a:ln w="-5" cap="bad" cmpd="bad" algn="bad">'
      + patternFillXml + '<a:prstDash val="bad"/><a:miter lim="-1"/></a:ln>')

    expect(entries).toEqual([{ ...patternFill, join: 'miter' }])
  })

  // Filtering nulls would shift later lnRef indexes; recognizing patterns must not discard bad slots.
  it('preserves picture, empty and unreadable slots between valid gradient and pattern lines', async () => {
    const entries = await lineStyles('<a:ln w="12700">' + gradientFillXml + '</a:ln>'
      + '<a:ln w="6350"><a:blipFill><a:blip/></a:blipFill></a:ln>'
      + '<a:ln><a:noFill/></a:ln><a:ln><a:pattFill prst="pct10"><a:fgClr><a:srgbClr val="112233"/></a:fgClr></a:pattFill></a:ln>'
      + '<a:ln><a:gradFill><a:gsLst/><a:lin ang="0"/></a:gradFill></a:ln><a:unknown/>'
      + '<a:ln w="25400">' + patternFillXml + '</a:ln>')

    expect(entries).toEqual([{ ...gradientFill, width: 12700 }, null, null, null, null, null, { ...patternFill, width: 25400 }])
  })
})

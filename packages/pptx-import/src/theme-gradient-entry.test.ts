import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

const masterRelationships = '<Relationships xmlns="r"><Relationship Id="rIdTheme"'
  + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"'
  + ' Target="../theme/theme1.xml"/></Relationships>'

function themeWith(fillStyleList: string, backgroundList = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'): string {
  return '<a:theme xmlns:a="a" name="Office"><a:themeElements>'
    + '<a:clrScheme name="Office"><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme>'
    + `<a:fmtScheme name="Office"><a:fillStyleLst>${fillStyleList}</a:fillStyleLst>`
    + '<a:lnStyleLst/><a:effectStyleLst/>'
    + `<a:bgFillStyleLst>${backgroundList}</a:bgFillStyleLst></a:fmtScheme>`
    + '</a:themeElements></a:theme>'
}

async function formatScheme(fillStyleList: string, backgroundList?: string) {
  const document = await importPptx(createStoredZip({
    ...files,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': masterRelationships,
    'ppt/theme/theme1.xml': backgroundList ? themeWith(fillStyleList, backgroundList) : themeWith(fillStyleList),
  }))
  return Object.values(document.themes ?? {})[0]?.formatScheme
}

const officeGradient = '<a:gradFill rotWithShape="1"><a:gsLst>'
  + '<a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="67000"/></a:schemeClr></a:gs>'
  + '<a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="100000"/></a:schemeClr></a:gs>'
  + '</a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>'

describe('theme gradient entries on import', () => {
  /** Before this the stock Office gradient entry was `null` and nothing pointing at it painted. */
  it('models a stock Office gradient entry', async () => {
    const scheme = await formatScheme('<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' + officeGradient)

    expect(scheme?.fillStyles).toEqual([
      { color: { type: 'scheme', v: 'phClr' } },
      {
        color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'tint', value: 67000 }] },
        gradient: {
          stops: [
            { pos: 0, color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'tint', value: 67000 }] } },
            { pos: 100000, color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'shade', value: 100000 }] } },
          ],
          angle: 5400000,
          scaled: false,
        },
      },
    ])
  })

  it('models a gradient entry in the background list too', async () => {
    const scheme = await formatScheme('<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>', officeGradient)

    expect(scheme?.backgroundStyles?.[0]).toMatchObject({ gradient: { angle: 5400000 } })
  })

  /**
   * `a:path` is expressible now, so a theme entry holding one is a real entry rather than the `null` that
   * means "a form the model cannot state" — a shape taking its fill from this `fillRef` gets the circle.
   */
  it('models a path gradient entry instead of nulling it', async () => {
    const scheme = await formatScheme(
      '<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs>'
      + '<a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs></a:gsLst>'
      + '<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>',
    )

    expect(scheme?.fillStyles?.[0]).toMatchObject({ gradient: { path: 'circle', fillToRect: { left: 50000, top: 50000, right: 50000, bottom: 50000 } } })
  })

  it('still nulls a pattern or picture entry', async () => {
    expect((await formatScheme('<a:pattFill prst="pct5"/>'))?.fillStyles).toEqual([null])
    expect((await formatScheme('<a:blipFill><a:blip/></a:blipFill>'))?.fillStyles).toEqual([null])
  })

  /** One stop is a flat colour, so the entry becomes a plain fill rather than a one-stop ramp. */
  it('degrades a single-stop gradient entry to a plain fill', async () => {
    const scheme = await formatScheme(
      '<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill>',
    )

    expect(scheme?.fillStyles).toEqual([{ color: { type: 'scheme', v: 'phClr' } }])
  })

  it('keeps the entry order so indexes stay put', async () => {
    const scheme = await formatScheme(officeGradient + '<a:pattFill prst="pct5"/><a:solidFill><a:srgbClr val="203864"/></a:solidFill>')

    expect(scheme?.fillStyles?.[1]).toBeNull()
    expect(scheme?.fillStyles?.[2]).toEqual({ color: { type: 'srgb', v: '203864' } })
  })
})

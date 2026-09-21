import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

const masterRelationships = '<Relationships xmlns="r"><Relationship Id="rIdTheme"'
  + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"'
  + ' Target="../theme/theme1.xml"/></Relationships>'

/** The stock Office shape: nothing in spPr, every colour comes from the style matrix. */
const styledShape = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
  + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Styled"/><p:nvPr/></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
  + '<a:prstGeom prst="rect"/></p:spPr>'
  + '<p:style>'
  + '<a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef>'
  + '<a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef>'
  + '<a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>'
  + '<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef>'
  + '</p:style></p:sp>'
  + '</p:spTree></p:cSld></p:sld>'

const theme = '<a:theme xmlns:a="a" name="Office"><a:themeElements>'
  + '<a:clrScheme name="Office"><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme>'
  + '<a:fmtScheme name="Office">'
  + '<a:fillStyleLst>'
  + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
  + '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs></a:gsLst></a:gradFill>'
  + '</a:fillStyleLst>'
  + '<a:lnStyleLst>'
  + '<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'
  + '<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"><a:tint val="60000"/></a:schemeClr></a:solidFill></a:ln>'
  + '</a:lnStyleLst>'
  + '<a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme>'
  + '</a:themeElements></a:theme>'

async function importStyled(slide = styledShape, themeXml = theme) {
  return importPptx(createStoredZip({
    ...files,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': masterRelationships,
    'ppt/theme/theme1.xml': themeXml,
    'ppt/slides/slide1.xml': slide,
  }))
}

describe('shape style matrix on import', () => {
  it('reads all four style references with their placeholder colours', async () => {
    const document = await importStyled()

    expect(document.elements.el_1).toMatchObject({
      kind: 'shape',
      styleRef: {
        line: { idx: 2, color: { type: 'scheme', v: 'accent1', transforms: [{ type: 'shade', value: 50000 }] } },
        fill: { idx: 1, color: { type: 'scheme', v: 'accent1' } },
        effect: { idx: 0, color: { type: 'scheme', v: 'accent1' } },
        font: { idx: 'minor', color: { type: 'scheme', v: 'lt1' } },
      },
    })
  })

  /** A gradient entry cannot be expressed as a `Fill`, and an invented approximation would hide the gap. */
  it('records solid theme entries and nulls the ones it cannot express', async () => {
    const formatScheme = Object.values((await importStyled()).themes ?? {})[0]?.formatScheme

    expect(formatScheme?.fillStyles).toEqual([{ color: { type: 'scheme', v: 'phClr' } }, null])
    // Line entries also carry the `a:ln` width; the fixture's two entries are 0.5pt and 1pt.
    expect(formatScheme?.lineStyles).toEqual([
      { color: { type: 'scheme', v: 'phClr' }, width: 6350 },
      { color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'tint', value: 60000 }] }, width: 12700 },
    ])
  })

  it('omits styleRef when the shape has no p:style', async () => {
    const slide = styledShape.replace(/<p:style>.*<\/p:style>/u, '')

    expect(await importStyled(slide).then((document) => document.elements.el_1)).not.toHaveProperty('styleRef')
  })

  it('omits formatScheme when the theme has no fmtScheme', async () => {
    const withoutScheme = theme.replace(/<a:fmtScheme.*<\/a:fmtScheme>/u, '')

    expect(Object.values((await importStyled(styledShape, withoutScheme)).themes ?? {})[0]).not.toHaveProperty('formatScheme')
  })
})

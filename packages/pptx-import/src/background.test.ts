import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

const masterRelationships = '<Relationships xmlns="r"><Relationship Id="rIdTheme"'
  + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"'
  + ' Target="../theme/theme1.xml"/></Relationships>'

function slideWith(background: string): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld>'
    + background
    + '<p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm></p:spPr>'
    + '<p:txBody><a:bodyPr/><a:p><a:r><a:t>On dark</a:t></a:r></a:p></p:txBody></p:sp>'
    + '</p:spTree></p:cSld></p:sld>'
}

const masterWithBackgroundRef = '<p:sldMaster xmlns:p="p" xmlns:a="a"><p:cSld>'
  + '<p:bg><p:bgRef idx="1001"><a:schemeClr val="lt1"/></p:bgRef></p:bg>'
  + '<p:spTree/></p:cSld>'
  + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"'
  + ' accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
  + '</p:sldMaster>'

const layoutWithBackground = '<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld>'
  + '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="203864"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>'
  + '<p:spTree/></p:cSld></p:sldLayout>'

const theme = '<a:theme xmlns:a="a" name="Office"><a:themeElements>'
  + '<a:clrScheme name="Office"><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1></a:clrScheme>'
  + '<a:fmtScheme name="Office"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/>'
  + '<a:bgFillStyleLst>'
  + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
  + '<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs></a:gsLst></a:gradFill>'
  + '</a:bgFillStyleLst>'
  + '</a:fmtScheme></a:themeElements></a:theme>'

async function importBackground(slideBackground: string) {
  return importPptx(createStoredZip({
    ...files,
    'ppt/slideMasters/slideMaster1.xml': masterWithBackgroundRef,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': masterRelationships,
    'ppt/slideLayouts/slideLayout1.xml': layoutWithBackground,
    'ppt/theme/theme1.xml': theme,
    'ppt/slides/slide1.xml': slideWith(slideBackground),
  }))
}

describe('slide background on import', () => {
  it('reads a direct fill on the slide', async () => {
    const document = await importBackground('<p:bg><p:bgPr><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>')

    expect(document.slides.sld_1?.background).toEqual({ fill: { color: { type: 'srgb', v: '1F3864' } } })
  })

  it('reads a direct fill on the layout and a style reference on the master', async () => {
    const document = await importBackground('')

    expect(document.slides.sld_1).not.toHaveProperty('background')
    expect(document.layouts?.lyt_1?.background).toEqual({ fill: { color: { type: 'srgb', v: '203864' } } })
    // The file's own index is kept: 1001 means the first entry, where `fillRef` counts from 1.
    expect(document.masters?.mst_1?.background).toEqual({ styleRef: { idx: 1001, color: { type: 'scheme', v: 'lt1' } } })
  })

  it('reads the background style list, nulling entries it cannot express', async () => {
    const document = await importBackground('')
    const formatScheme = Object.values(document.themes ?? {})[0]?.formatScheme

    expect(formatScheme?.backgroundStyles).toEqual([{ color: { type: 'scheme', v: 'phClr' } }, null])
  })

  it('ignores a background block with nothing it can read', async () => {
    const document = await importBackground('<p:bg><p:bgPr><a:noFill/></p:bgPr></p:bg>')

    expect(document.slides.sld_1).not.toHaveProperty('background')
  })
})

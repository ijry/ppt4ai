import { describe, expect, it } from 'vitest'
import { importPptx } from './importer'
import { createStoredZip, files } from './test-fixtures'

const shadowEntry = '<a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" dist="19050" dir="5400000" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle>'
const placeholderEntry = '<a:effectStyle><a:effectLst><a:outerShdw blurRad="76200"><a:schemeClr val="phClr"><a:alpha val="40000"/></a:schemeClr></a:outerShdw></a:effectLst></a:effectStyle>'
const emptyEntry = '<a:effectStyle><a:effectLst/></a:effectStyle>'
const glowEntry = '<a:effectStyle><a:effectLst><a:glow rad="63500"><a:srgbClr val="FF0000"/></a:glow></a:effectLst></a:effectStyle>'

function themeXml(effectStyles: string): string {
  return '<a:theme xmlns:a="a"><a:themeElements>'
    + '<a:clrScheme name="probe"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1></a:clrScheme>'
    + '<a:fontScheme name="probe"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme>'
    + `<a:fmtScheme name="probe"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>${effectStyles}</a:fmtScheme>`
    + '</a:themeElements></a:theme>'
}

async function effectStylesOf(effectStyles: string) {
  const document = await importPptx(createStoredZip({
    ...files,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>',
    'ppt/theme/theme1.xml': themeXml(effectStyles),
  }))
  return Object.values(document.themes ?? {})[0]?.formatScheme?.effectStyles
}

describe('theme effect styles on import', () => {
  it('reads the three entries of an Office-shaped list', async () => {
    expect(await effectStylesOf(`<a:effectStyleLst>${emptyEntry}${shadowEntry}${placeholderEntry}</a:effectStyleLst>`)).toEqual([
      null,
      {
        color: { type: 'srgb', v: '000000', transforms: [{ type: 'alpha', value: 63000 }] },
        blurRadius: 57150,
        distance: 19050,
        direction: 5400000,
      },
      {
        color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'alpha', value: 40000 }] },
        blurRadius: 76200,
      },
    ])
  })

  /** `null` is the slot-preserving "nothing paintable", the same convention the fill entries use. */
  it('records an effect it cannot express as null', async () => {
    expect(await effectStylesOf(`<a:effectStyleLst>${glowEntry}</a:effectStyleLst>`)).toEqual([null])
  })

  it('records a shadow with no usable colour as null', async () => {
    const colourless = '<a:effectStyle><a:effectLst><a:outerShdw blurRad="12700"/></a:effectLst></a:effectStyle>'

    expect(await effectStylesOf(`<a:effectStyleLst>${colourless}</a:effectStyleLst>`)).toEqual([null])
  })

  it('leaves the field absent when the theme declares no effect list', async () => {
    expect(await effectStylesOf('')).toBeUndefined()
  })
})

import type { Theme } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { rewriteThemeXml } from './theme-writeback.js'

const sourceTheme = '<a:theme xmlns:a="a" data-theme="keep"><a:themeElements><a:clrScheme name="Custom" data-scheme="keep"><a:accent1 data-slot="keep"><a:srgbClr val="336699"><a:lumMod val="80000"/><a:satMod val="160000"/><a:customTransform keep="yes"/></a:srgbClr><a:extLst data-ext="keep"/></a:accent1><a:accent2><a:customSlot keep="yes"/></a:accent2></a:clrScheme><a:fontScheme data-font="keep"/></a:themeElements></a:theme>'

describe('rewriteThemeXml', () => {
  it('patches a changed color while preserving the surrounding theme XML', () => {
    const rewritten = rewriteThemeXml(sourceTheme, {
      id: 'theme_1',
      colors: {
        accent1: { type: 'srgb', v: 'FF0000', transforms: [{ type: 'alpha', value: 50000 }] },
      },
    })

    expect(rewritten).toContain('<a:theme xmlns:a="a" data-theme="keep">')
    expect(rewritten).toContain('<a:accent1 data-slot="keep"><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr><a:extLst data-ext="keep"/></a:accent1>')
    expect(rewritten).toContain('<a:accent2><a:customSlot keep="yes"/></a:accent2>')
    expect(rewritten).toContain('<a:fontScheme data-font="keep"/>')
  })

  it('inserts a missing slot with the clrScheme namespace prefix', () => {
    const rewritten = rewriteThemeXml(sourceTheme, {
      id: 'theme_1',
      colors: { accent3: { type: 'scheme', v: 'accent1' } },
    })

    expect(rewritten).toContain('<a:accent3><a:schemeClr val="accent1"/></a:accent3>')
  })

  it('resets null colors to valid Office defaults while preserving slot XML', () => {
    const rewritten = rewriteThemeXml(sourceTheme, {
      id: 'theme_1',
      colors: { accent1: null, accent2: null },
    })

    expect(rewritten).toContain('<a:accent1 data-slot="keep"><a:srgbClr val="4472C4"/><a:extLst data-ext="keep"/></a:accent1>')
    expect(rewritten).toContain('<a:accent2><a:customSlot keep="yes"/><a:srgbClr val="ED7D31"/></a:accent2>')
    expect(rewritten).toContain('<a:fontScheme data-font="keep"/>')
  })

  /**
   * The three transforms the source writes are the three the importer would have put in the model —
   * `satMod` uncapped, the valueless switch form kept as a word — so an untouched slot writes nothing.
   * The narrower allowlist this replaces threw `theme color unsupported` on the `satMod` instead.
   */
  it('returns the exact source when defined colors are unchanged', () => {
    expect(rewriteThemeXml(sourceTheme, {
      id: 'theme_1',
      colors: {
        accent1: {
          type: 'srgb',
          v: '336699',
          transforms: [{ type: 'lumMod', value: 80000 }, { type: 'satMod', value: 160000 }, { type: 'customTransform' }],
        },
      },
    })).toBe(sourceTheme)
  })

  it('rejects malformed theme source with a stable error', () => {
    expect(() => rewriteThemeXml('<a:theme>', {
      id: 'theme_1',
      colors: { accent1: { type: 'srgb', v: 'FF0000' } },
    } satisfies Theme)).toThrow('PPTX export theme')
  })
})

const fontTheme = '<a:theme xmlns:a="a"><a:themeElements><a:clrScheme name="Custom"><a:dk1><a:srgbClr val="000000"/></a:dk1></a:clrScheme>'
  + '<a:fontScheme name="Custom">'
  + '<a:majorFont><a:latin typeface="Cambria" panose="02040503050406030204" pitchFamily="18" charset="0"/><a:ea typeface=" 宋体 "/><a:cs typeface=""/>'
  + '<a:font script="Hans" typeface="等线"/></a:majorFont>'
  + '<a:minorFont><a:ea typeface=""/><a:extLst data-ext="keep"/></a:minorFont>'
  + '</a:fontScheme></a:themeElements></a:theme>'

describe('rewriteThemeXml font scheme', () => {
  it('patches one typeface while keeping the unmodeled attributes and sibling nodes', () => {
    const rewritten = rewriteThemeXml(fontTheme, {
      id: 'theme_1',
      colors: {},
      fonts: { major: { latin: 'Georgia & "Co"' } },
    })

    expect(rewritten).toContain('<a:latin typeface="Georgia &amp; &quot;Co&quot;" panose="02040503050406030204" pitchFamily="18" charset="0"/>')
    expect(rewritten).toContain('<a:font script="Hans" typeface="等线"/>')
    expect(rewritten).toContain('<a:cs typeface=""/>')
  })

  /** The importer trims `typeface`, so comparing untrimmed would rewrite a theme nobody edited. */
  it('returns the exact source when the modeled typefaces match, whitespace aside', () => {
    expect(rewriteThemeXml(fontTheme, {
      id: 'theme_1',
      colors: {},
      fonts: { major: { latin: 'Cambria', ea: '宋体' }, minor: { ea: null } },
    })).toBe(fontTheme)
  })

  it('resets a null typeface to the built-in default', () => {
    const rewritten = rewriteThemeXml(fontTheme, {
      id: 'theme_1',
      colors: {},
      fonts: { major: { latin: null } },
    })

    expect(rewritten).toContain('<a:latin typeface="Aptos Display" panose="02040503050406030204"')
  })

  it('inserts a missing script node before the nodes that must follow it', () => {
    const rewritten = rewriteThemeXml(fontTheme, {
      id: 'theme_1',
      colors: {},
      fonts: { minor: { latin: 'Calibri', cs: 'Arial' } },
    })

    expect(rewritten).toContain('<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface="Arial"/><a:extLst data-ext="keep"/></a:minorFont>')
  })

  it('builds a missing font collection with all three scripts', () => {
    const rewritten = rewriteThemeXml(sourceTheme, {
      id: 'theme_1',
      colors: {},
      fonts: { minor: { ea: '等线' } },
    })

    expect(rewritten).toContain('<a:fontScheme data-font="keep"><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface="等线"/><a:cs typeface=""/></a:minorFont></a:fontScheme>')
  })

  it('leaves the font scheme alone when the model carries no typeface', () => {
    expect(rewriteThemeXml(fontTheme, { id: 'theme_1', colors: {}, fonts: { major: {} } })).toBe(fontTheme)
  })

  it('rejects a source without a font scheme once fonts are modeled', () => {
    const withoutFonts = '<a:theme xmlns:a="a"><a:themeElements><a:clrScheme><a:dk1><a:srgbClr val="000000"/></a:dk1></a:clrScheme></a:themeElements></a:theme>'

    expect(() => rewriteThemeXml(withoutFonts, { id: 'theme_1', colors: {}, fonts: { major: { latin: 'Georgia' } } }))
      .toThrow('PPTX export theme source malformed: theme_1')
  })

  it('rejects an unusable typeface with a stable error', () => {
    expect(() => rewriteThemeXml(fontTheme, {
      id: 'theme_1',
      colors: {},
      fonts: { major: { latin: 'Bad\u0000Font' } },
    })).toThrow('PPTX export theme font unsupported: theme_1.major.latin')

    expect(() => rewriteThemeXml(fontTheme, {
      id: 'theme_1',
      colors: {},
      fonts: { minor: { latin: '' } },
    })).toThrow('PPTX export theme font unsupported: theme_1.minor.latin')
  })
})

const matrixTheme = '<a:theme xmlns:a="a"><a:themeElements><a:clrScheme name="Custom"><a:accent1><a:srgbClr val="336699"/></a:accent1></a:clrScheme>'
  + '<a:fontScheme name="Custom"/>'
  + '<a:fmtScheme name="Custom"><a:fillStyleLst>'
  + '<a:gradFill rotWithShape="1"><a:gsLst>'
  + '<a:gs pos="0"><a:schemeClr val="phClr"><a:satMod val="105000"/><a:tint val="67000"/></a:schemeClr></a:gs>'
  + '<a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="100000"/></a:schemeClr></a:gs>'
  + '</a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>'
  + '</a:fillStyleLst><a:lnStyleLst>'
  + '<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>'
  + '<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="lgDashDot"/></a:ln>'
  + '</a:lnStyleLst></a:fmtScheme></a:themeElements></a:theme>'

/**
 * Fill, background and line slots now have source writeback; effect styles are still deferred.
 * lgDashDot is modeled verbatim, so this fixture must describe what the importer actually reads.
 */
describe('rewriteThemeXml format scheme', () => {
  it('leaves the line style list untouched when a colour changes', () => {
    const rewritten = rewriteThemeXml(matrixTheme, {
      id: 'theme_1',
      colors: { accent1: { type: 'srgb', v: 'FF0000' } },
      formatScheme: {
        lineStyles: [
          { color: { type: 'scheme', v: 'phClr' }, width: 6350, cap: 'flat', compound: 'sng', align: 'ctr' },
          { color: { type: 'scheme', v: 'phClr' }, width: 12700, style: 'lgDashDot' },
        ],
      },
    })

    expect(rewritten).toContain('<a:accent1><a:srgbClr val="FF0000"/></a:accent1>')
    expect(rewritten).toContain('<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>')
    expect(rewritten).toContain('<a:prstDash val="lgDashDot"/>')
    expect(rewritten).not.toContain('val="dash"')
  })

  /**
   * satMod has been modeled since the transform-token slice. Supplying a model without it is an
   * edit, not an unchanged import: mirror the current importer to test source preservation.
   */
  it('leaves an unedited gradient entry untouched when its modeled transforms match', () => {
    const rewritten = rewriteThemeXml(matrixTheme, {
      id: 'theme_1',
      colors: { accent1: { type: 'srgb', v: 'FF0000' } },
      formatScheme: {
        fillStyles: [{
          color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'satMod', value: 105000 }, { type: 'tint', value: 67000 }] },
          gradient: {
            stops: [
              { pos: 0, color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'satMod', value: 105000 }, { type: 'tint', value: 67000 }] } },
              { pos: 100000, color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'shade', value: 100000 }] } },
            ],
            angle: 5400000,
            scaled: false,
          },
        }],
      },
    })

    expect(rewritten).toBe(matrixTheme.replace('val="336699"', 'val="FF0000"'))
  })

  it('returns the exact source when only an unchanged prefix of the line list is supplied', () => {
    expect(rewriteThemeXml(matrixTheme, {
      id: 'theme_1',
      colors: { accent1: { type: 'srgb', v: '336699' } },
      formatScheme: { lineStyles: [{ color: { type: 'scheme', v: 'phClr' }, width: 6350, cap: 'flat', compound: 'sng', align: 'ctr' }] },
    })).toBe(matrixTheme)
  })
})

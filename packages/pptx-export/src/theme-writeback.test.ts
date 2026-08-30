import type { Theme } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { rewriteThemeXml } from './theme-writeback.js'

const sourceTheme = '<a:theme xmlns:a="a" data-theme="keep"><a:themeElements><a:clrScheme name="Custom" data-scheme="keep"><a:accent1 data-slot="keep"><a:srgbClr val="336699"><a:lumMod val="80000"/><a:customTransform keep="yes"/></a:srgbClr><a:extLst data-ext="keep"/></a:accent1><a:accent2><a:customSlot keep="yes"/></a:accent2></a:clrScheme><a:fontScheme data-font="keep"/></a:themeElements></a:theme>'

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

  it('returns the exact source when defined colors are unchanged', () => {
    expect(rewriteThemeXml(sourceTheme, {
      id: 'theme_1',
      colors: { accent1: { type: 'srgb', v: '336699', transforms: [{ type: 'lumMod', value: 80000 }] } },
    })).toBe(sourceTheme)
  })

  it('rejects malformed theme source with a stable error', () => {
    expect(() => rewriteThemeXml('<a:theme>', {
      id: 'theme_1',
      colors: { accent1: { type: 'srgb', v: 'FF0000' } },
    } satisfies Theme)).toThrow('PPTX export theme')
  })
})

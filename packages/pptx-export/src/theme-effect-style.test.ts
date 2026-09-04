import { importPptx } from '@ppt4ai/pptx-import'
import type { Ppt4aiDocument, Theme } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx } from './index.js'
import { rewriteThemeXml } from './theme-writeback.js'
import { readZipEntries } from './zip.js'

const theme: Theme = {
  id: 'theme_1',
  colors: { accent1: { type: 'srgb', v: '4472C4' } },
  formatScheme: {
    effectStyles: [
      null,
      { color: { type: 'srgb', v: '000000', transforms: [{ type: 'alpha', value: 63000 }] }, blurRadius: 57150, distance: 19050, direction: 5400000 },
    ],
  },
}

const document: Ppt4aiDocument = {
  format: 'ppt4ai',
  version: 1,
  id: 'dck_effect_styles',
  page: { w: 12192000, h: 6858000 },
  slides: { sld_1: { id: 'sld_1', elementIds: [] } },
  slideOrder: ['sld_1'],
  elements: {},
  masters: { mst_1: { id: 'mst_1', themeId: 'theme_1' } },
  themes: { theme_1: theme },
}

async function themeXmlOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  const data = entries.get('ppt/theme/theme1.xml')
  if (!data) throw new Error('missing generated theme')
  return new TextDecoder().decode(data)
}

describe('theme effect styles in standalone generation', () => {
  /**
   * Until this wrote real entries the list was three empty `a:effectLst`, so an `effectRef idx="2"` in
   * a generated package pointed at nothing — the last corner of the dangling-reference bug the fill and
   * line lists already fixed.
   */
  it('writes the modeled entries and pads the list to three', async () => {
    const xml = await themeXmlOf(await createPptx(document))
    const list = xml.slice(xml.indexOf('<a:effectStyleLst>'), xml.indexOf('</a:effectStyleLst>'))

    expect(list).toContain('<a:effectStyle><a:effectLst/></a:effectStyle>')
    expect(list).toContain('<a:outerShdw blurRad="57150" dist="19050" dir="5400000"><a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr></a:outerShdw>')
    expect(list.match(/<a:effectStyle>/gu)).toHaveLength(3)
  })

  it('round-trips the entries through the importer', async () => {
    const imported = await importPptx(await createPptx(document))

    expect(Object.values(imported.themes ?? {})[0]?.formatScheme?.effectStyles).toEqual([
      null,
      { color: { type: 'srgb', v: '000000', transforms: [{ type: 'alpha', value: 63000 }] }, blurRadius: 57150, distance: 19050, direction: 5400000 },
      null,
    ])
  })

  it('writes three empty entries for a theme that models none', async () => {
    const xml = await themeXmlOf(await createPptx({ ...document, themes: { theme_1: { id: 'theme_1', colors: {} } } }))

    expect(xml).toContain('<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>')
  })
})

/** Decision 5: a partial model must not rewrite entries that carry effects it cannot express. */
describe('theme effect styles in source writeback', () => {
  const sourceTheme = '<a:theme xmlns:a="a"><a:themeElements><a:clrScheme name="Custom"><a:accent1><a:srgbClr val="336699"/></a:accent1></a:clrScheme>'
    + '<a:fmtScheme name="Custom"><a:effectStyleLst><a:effectStyle><a:effectLst><a:glow rad="63500"><a:srgbClr val="FF0000"/></a:glow></a:effectLst></a:effectStyle>'
    + '<a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" sx="90000" algn="ctr"><a:srgbClr val="000000"/></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst></a:fmtScheme>'
    + '</a:themeElements></a:theme>'

  it('keeps the effect style list verbatim when a colour changes', () => {
    const rewritten = rewriteThemeXml(sourceTheme, { id: 'theme_1', colors: { accent1: { type: 'srgb', v: 'FF0000' } } })

    expect(rewritten).toContain('<a:accent1><a:srgbClr val="FF0000"/></a:accent1>')
    expect(rewritten).toContain(sourceTheme.slice(sourceTheme.indexOf('<a:effectStyleLst>'), sourceTheme.indexOf('</a:effectStyleLst>') + '</a:effectStyleLst>'.length))
  })

  it('returns the source untouched when the model adds effect entries it did not have', () => {
    expect(rewriteThemeXml(sourceTheme, { id: 'theme_1', colors: {}, formatScheme: theme.formatScheme ?? {} })).toBe(sourceTheme)
  })
})

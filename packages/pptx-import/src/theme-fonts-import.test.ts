import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

const masterRelationships = '<Relationships xmlns="r"><Relationship Id="rIdTheme"'
  + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"'
  + ' Target="../theme/theme1.xml"/></Relationships>'

function themeWith(elements: string): string {
  return `<a:theme xmlns:a="a" name="Custom"><a:themeElements>${elements}</a:themeElements></a:theme>`
}

const colorScheme = '<a:clrScheme name="Custom"><a:dk1><a:srgbClr val="000000"/></a:dk1></a:clrScheme>'

const fontScheme = '<a:fontScheme name="Custom">'
  + '<a:majorFont><a:latin typeface="Cambria"/><a:ea typeface="宋体"/><a:cs typeface=""/></a:majorFont>'
  + '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="等线"/><a:cs typeface=""/></a:minorFont>'
  + '</a:fontScheme>'

const slideUsingThemeFont = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
  + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr>'
  + '<p:txBody><a:bodyPr/><a:p><a:r><a:rPr><a:latin typeface="+mj-lt"/></a:rPr><a:t>Theme font</a:t></a:r></a:p></p:txBody></p:sp>'
  + '</p:spTree></p:cSld></p:sld>'

async function importTheme(theme: string, slide = files['ppt/slides/slide1.xml']) {
  const document = await importPptx(createStoredZip({
    ...files,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': masterRelationships,
    'ppt/theme/theme1.xml': theme,
    'ppt/slides/slide1.xml': slide,
  }))
  return document
}

describe('theme fonts on import', () => {
  it('reads majorFont and minorFont into the theme, dropping empty typefaces', async () => {
    const document = await importTheme(themeWith(colorScheme + fontScheme))

    expect(document.themes?.theme_1).toEqual({
      id: 'theme_1',
      colors: { dk1: { type: 'srgb', v: '000000' } },
      fonts: {
        major: { latin: 'Cambria', ea: '宋体' },
        minor: { latin: 'Calibri', ea: '等线' },
      },
      source: { partPath: 'ppt/theme/theme1.xml' },
    })
  })

  it('omits fonts when the theme has no fontScheme', async () => {
    const document = await importTheme(themeWith(colorScheme))

    expect(document.themes?.theme_1).not.toHaveProperty('fonts')
  })

  it('imports a theme that only carries fonts', async () => {
    const document = await importTheme(themeWith(fontScheme))

    expect(document.themes?.theme_1).toMatchObject({ colors: {}, fonts: { major: { latin: 'Cambria' } } })
    expect(document.masters?.mst_1?.themeId).toBe('theme_1')
  })

  /**
   * The reference stays in the model on purpose: the exporter writes `marks.fontFamily` straight
   * back into `<a:latin typeface>`, so expanding it here would pin the run to Cambria and stop it
   * following the theme. Resolution happens on the render side instead.
   */
  it('keeps a theme font reference verbatim in run marks', async () => {
    const document = await importTheme(themeWith(colorScheme + fontScheme), slideUsingThemeFont)

    const element = document.elements.el_1
    if (element?.kind !== 'text') throw new Error('fixture did not import as text')
    expect(element.body?.paragraphs[0]?.runs[0]?.marks).toEqual({ fontFamily: '+mj-lt' })
  })
})

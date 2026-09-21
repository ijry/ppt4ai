import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

const masterRelationships = '<Relationships xmlns="r"><Relationship Id="rIdTheme"'
  + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"'
  + ' Target="../theme/theme1.xml"/></Relationships>'

function slideWith(fill: string): string {
  return files['ppt/slides/slide1.xml'].replace('<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>', fill)
}

async function shapeFill(fill: string) {
  const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': slideWith(fill) }))
  const slide = Object.values(document.slides)[0]
  const id = slide?.elementIds[0]
  const element = id ? document.elements[id] : undefined
  return element && 'fill' in element ? element.fill : undefined
}

async function themeFillStyles(fillStyleList: string) {
  const theme = '<a:theme xmlns:a="a" name="Office"><a:themeElements>'
    + '<a:clrScheme name="Office"><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme>'
    + `<a:fmtScheme name="Office"><a:fillStyleLst>${fillStyleList}</a:fillStyleLst>`
    + '<a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme>'
    + '</a:themeElements></a:theme>'
  const document = await importPptx(createStoredZip({
    ...files,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': masterRelationships,
    'ppt/theme/theme1.xml': theme,
  }))
  return Object.values(document.themes ?? {})[0]?.formatScheme?.fillStyles
}

describe('pattern fill on import', () => {
  /** Before this the element had no `fill` key at all, so a patterned shape came out invisible. */
  it('reads the preset and both colours', async () => {
    expect(await shapeFill(
      '<a:pattFill prst="ltHorz"><a:fgClr><a:srgbClr val="FF0000"/></a:fgClr>'
      + '<a:bgClr><a:srgbClr val="00FF00"/></a:bgClr></a:pattFill>',
    )).toEqual({
      color: { type: 'srgb', v: 'FF0000' },
      pattern: {
        preset: 'ltHorz',
        foreground: { type: 'srgb', v: 'FF0000' },
        background: { type: 'srgb', v: '00FF00' },
      },
    })
  })

  /** `color` mirrors the foreground so a consumer that only reads `color` paints something. */
  it('mirrors the foreground into the fill colour', async () => {
    const fill = await shapeFill(
      '<a:pattFill prst="pct50"><a:fgClr><a:schemeClr val="accent1"/></a:fgClr>'
      + '<a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill>',
    )

    expect(fill?.color).toEqual({ type: 'scheme', v: 'accent1' })
    expect(fill?.color).toEqual(fill?.pattern?.foreground)
  })

  /** The same rule the `prst` geometry word follows: the model preserves the word, it does not police it. */
  it('keeps an unknown preset verbatim', async () => {
    const fill = await shapeFill(
      '<a:pattFill prst="someFuturePattern"><a:fgClr><a:srgbClr val="000000"/></a:fgClr>'
      + '<a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill>',
    )

    expect(fill?.pattern?.preset).toBe('someFuturePattern')
  })

  it('drops a pattern missing its preset or either colour', async () => {
    expect(await shapeFill('<a:pattFill><a:fgClr><a:srgbClr val="FF0000"/></a:fgClr>'
      + '<a:bgClr><a:srgbClr val="00FF00"/></a:bgClr></a:pattFill>')).toBeUndefined()
    expect(await shapeFill('<a:pattFill prst="ltHorz"><a:bgClr><a:srgbClr val="00FF00"/></a:bgClr></a:pattFill>'))
      .toBeUndefined()
    expect(await shapeFill('<a:pattFill prst="ltHorz"><a:fgClr><a:srgbClr val="FF0000"/></a:fgClr></a:pattFill>'))
      .toBeUndefined()
  })

  /** Before this the theme entry was `null`, so a `fillRef` pointing at it resolved to nothing. */
  it('reads a theme fill style pattern entry', async () => {
    expect(await themeFillStyles(
      '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
      + '<a:pattFill prst="dkUpDiag"><a:fgClr><a:schemeClr val="phClr"/></a:fgClr>'
      + '<a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill>',
    )).toEqual([
      { color: { type: 'scheme', v: 'phClr' } },
      {
        color: { type: 'scheme', v: 'phClr' },
        pattern: {
          preset: 'dkUpDiag',
          foreground: { type: 'scheme', v: 'phClr' },
          background: { type: 'srgb', v: 'FFFFFF' },
        },
      },
    ])
  })
})

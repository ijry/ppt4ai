import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

function slideWith(body: string): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Paragraphs"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr>'
    + `<p:txBody>${body}</p:txBody></p:sp>`
    + '</p:spTree></p:cSld></p:sld>'
}

async function textElement(body: string) {
  const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': slideWith(body) }))
  const element = document.elements.el_1
  if (element?.kind !== 'text') throw new Error('fixture did not import as text')
  return element
}

async function firstAttrs(paragraphProperties: string) {
  const element = await textElement(`<a:bodyPr/><a:p>${paragraphProperties}<a:r><a:t>Body</a:t></a:r></a:p>`)
  return element.body?.paragraphs[0]?.attrs
}

async function bodyProperties(bodyPr: string) {
  const element = await textElement(`${bodyPr}<a:p><a:r><a:t>Body</a:t></a:r></a:p>`)
  return element.body?.bodyPr
}

describe('paragraph properties on import', () => {
  it('reads every supported attribute from one pPr', async () => {
    const attrs = await firstAttrs('<a:pPr algn="ctr" lvl="2" marL="457200" indent="228600">'
      + '<a:lnSpc><a:spcPct val="150000"/></a:lnSpc>'
      + '<a:spcBef><a:spcPts val="1200"/></a:spcBef>'
      + '<a:spcAft><a:spcPts val="600"/></a:spcAft>'
      + '</a:pPr>')

    expect(attrs).toEqual({
      align: 'center',
      level: 2,
      marginLeft: 457200,
      indent: 228600,
      lineSpacing: 150000,
      // spcPts is in hundredths of a point; 1200 -> 12 pt -> 152400 EMU.
      spaceBefore: 152400,
      spaceAfter: 76200,
    })
  })

  it('maps each alignment keyword', async () => {
    expect(await firstAttrs('<a:pPr algn="l"/>')).toEqual({ align: 'left' })
    expect(await firstAttrs('<a:pPr algn="ctr"/>')).toEqual({ align: 'center' })
    expect(await firstAttrs('<a:pPr algn="r"/>')).toEqual({ align: 'right' })
  })

  it('ignores an alignment the model cannot express', async () => {
    expect(await firstAttrs('<a:pPr algn="just"/>')).toBeUndefined()
  })

  it('keeps a negative indent, which is how OOXML writes a hanging indent', async () => {
    expect(await firstAttrs('<a:pPr marL="457200" indent="-228600"/>')).toEqual({ marginLeft: 457200, indent: -228600 })
  })

  it('drops a negative marginLeft, which the model rejects', async () => {
    expect(await firstAttrs('<a:pPr marL="-457200"/>')).toBeUndefined()
  })

  it('keeps the bullet alongside the other attributes', async () => {
    const attrs = await firstAttrs('<a:pPr algn="r"><a:buChar char="•"><a:rPr typeface="Wingdings"/></a:buChar></a:pPr>')

    expect(attrs).toEqual({ align: 'right', bullet: { type: 'char', char: '•', fontFamily: 'Wingdings' } })
  })

  it('skips a line spacing given in points, because the model stores a percentage', async () => {
    expect(await firstAttrs('<a:pPr><a:lnSpc><a:spcPts val="2400"/></a:lnSpc></a:pPr>')).toBeUndefined()
  })

  it('skips a paragraph spacing given as a percentage, because the model stores EMU', async () => {
    expect(await firstAttrs('<a:pPr><a:spcBef><a:spcPct val="50000"/></a:spcBef></a:pPr>')).toBeUndefined()
  })

  it('omits attrs entirely when pPr carries nothing we model', async () => {
    expect(await firstAttrs('<a:pPr rtl="0"/>')).toBeUndefined()
  })

  it('omits attrs when there is no pPr', async () => {
    expect(await firstAttrs('')).toBeUndefined()
  })

  it('gives each paragraph its own attributes', async () => {
    const element = await textElement('<a:bodyPr/>'
      + '<a:p><a:pPr algn="ctr"/><a:r><a:t>One</a:t></a:r></a:p>'
      + '<a:p><a:pPr lvl="1"/><a:r><a:t>Two</a:t></a:r></a:p>')

    expect(element.body?.paragraphs.map((paragraph) => paragraph.attrs)).toEqual([{ align: 'center' }, { level: 1 }])
  })
})

describe('body properties on import', () => {
  it('reads insets, anchor and wrap', async () => {
    expect(await bodyProperties('<a:bodyPr lIns="91440" tIns="45720" rIns="12700" bIns="25400" anchor="ctr" wrap="none"/>')).toEqual({
      insets: { left: 91440, top: 45720, right: 12700, bottom: 25400 },
      verticalAlign: 'middle',
      wrap: 'none',
    })
  })

  it('maps each anchor keyword', async () => {
    expect(await bodyProperties('<a:bodyPr anchor="t"/>')).toEqual({ verticalAlign: 'top' })
    expect(await bodyProperties('<a:bodyPr anchor="ctr"/>')).toEqual({ verticalAlign: 'middle' })
    expect(await bodyProperties('<a:bodyPr anchor="b"/>')).toEqual({ verticalAlign: 'bottom' })
  })

  it('needs all four insets before recording any, since the model has no partial form', async () => {
    expect(await bodyProperties('<a:bodyPr lIns="91440" tIns="45720"/>')).toBeUndefined()
  })

  it('accepts a zero inset', async () => {
    expect(await bodyProperties('<a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"/>')).toMatchObject({
      insets: { left: 0, top: 0, right: 0, bottom: 0 },
    })
  })

  it('reads the three autofit forms', async () => {
    expect(await bodyProperties('<a:bodyPr><a:noAutofit/></a:bodyPr>')).toEqual({ autofit: { type: 'none' } })
    expect(await bodyProperties('<a:bodyPr><a:normAutofit fontScale="80000"/></a:bodyPr>')).toEqual({ autofit: { type: 'shrink', minFontScale: 80000 } })
    expect(await bodyProperties('<a:bodyPr><a:spAutoFit/></a:bodyPr>')).toEqual({ autofit: { type: 'resize' } })
  })

  it('reads normAutofit without a fontScale as a bare shrink', async () => {
    expect(await bodyProperties('<a:bodyPr><a:normAutofit/></a:bodyPr>')).toEqual({ autofit: { type: 'shrink' } })
  })

  it('does not read lnSpcReduction as maxHeight', async () => {
    // The exporter writes maxHeight into spAutoFit@lnSpcReduction, which ECMA-376 puts on
    // normAutofit and not on spAutoFit at all. Reading it back would cement that mistake.
    expect(await bodyProperties('<a:bodyPr><a:spAutoFit lnSpcReduction="20000"/></a:bodyPr>')).toEqual({ autofit: { type: 'resize' } })
  })

  it('keeps the existing vertical reading alongside the new fields', async () => {
    expect(await bodyProperties('<a:bodyPr vert="vert" anchor="b"/>')).toEqual({ vertical: 'vertical', verticalAlign: 'bottom' })
  })

  it('omits bodyPr entirely when it carries nothing we model', async () => {
    expect(await bodyProperties('<a:bodyPr rtlCol="0"/>')).toBeUndefined()
  })

  it('omits bodyPr when the element has none', async () => {
    expect(await bodyProperties('')).toBeUndefined()
  })
})

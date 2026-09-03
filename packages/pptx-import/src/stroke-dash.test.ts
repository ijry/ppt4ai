import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

function slideWith(line: string): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Outlined"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `<a:prstGeom prst="rect"/>${line}</p:spPr></p:sp>`
    + '</p:spTree></p:cSld></p:sld>'
}

const navy = '<a:solidFill><a:srgbClr val="203864"/></a:solidFill>'

async function firstElement(line: string) {
  const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': slideWith(line) }))
  return document.elements.el_1
}

describe('stroke dash on import', () => {
  /** Before this, four outlines differing only in `prstDash` produced byte-identical models. */
  it('reads the two dash styles painting can express', async () => {
    expect(await firstElement(`<a:ln w="38100">${navy}<a:prstDash val="dash"/></a:ln>`)).toMatchObject({ strokeStyle: 'dash' })
    expect(await firstElement(`<a:ln w="38100">${navy}<a:prstDash val="dot"/></a:ln>`)).toMatchObject({ strokeStyle: 'dot' })
  })

  /** `solid` is the default state, so it stays out of the model rather than landing on every outline. */
  it('omits the style for a solid outline, however the source spells it', async () => {
    expect(await firstElement(`<a:ln w="38100">${navy}</a:ln>`)).not.toHaveProperty('strokeStyle')
    expect(await firstElement(`<a:ln w="38100">${navy}<a:prstDash val="solid"/></a:ln>`)).not.toHaveProperty('strokeStyle')
  })

  /** OOXML has eleven tokens and the painter has two patterns, so the rest collapse. */
  it('collapses the dashed variants onto dash', async () => {
    for (const value of ['lgDash', 'dashDot', 'lgDashDot', 'lgDashDotDot', 'sysDash', 'sysDashDot', 'sysDashDotDot']) {
      expect(await firstElement(`<a:ln w="38100">${navy}<a:prstDash val="${value}"/></a:ln>`)).toMatchObject({ strokeStyle: 'dash' })
    }
  })

  it('collapses sysDot onto dot', async () => {
    expect(await firstElement(`<a:ln w="38100">${navy}<a:prstDash val="sysDot"/></a:ln>`)).toMatchObject({ strokeStyle: 'dot' })
  })

  /** A dash with no outline colour has nothing to paint, so the style would be dead weight. */
  it('omits the style when the line declares no fill', async () => {
    expect(await firstElement('<a:ln w="38100"><a:prstDash val="dash"/></a:ln>')).not.toHaveProperty('strokeStyle')
  })

  it('reads the dash style of a shape that carries text', async () => {
    const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
      + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Labelled"/><p:nvPr/></p:nvSpPr>'
      + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
      + `<a:prstGeom prst="roundRect"/><a:ln w="38100">${navy}<a:prstDash val="dot"/></a:ln></p:spPr>`
      + '<p:txBody><a:bodyPr/><a:p><a:r><a:t>Label</a:t></a:r></a:p></p:txBody></p:sp>'
      + '</p:spTree></p:cSld></p:sld>'
    const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': slide }))

    expect(document.elements.el_1).toMatchObject({ kind: 'text', strokeStyle: 'dot' })
  })
})

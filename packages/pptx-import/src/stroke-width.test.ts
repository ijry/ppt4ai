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

describe('stroke width on import', () => {
  /** Before this a 1pt and a 6pt outline produced byte-identical models, so both painted as hairlines. */
  it('reads the line width in EMU', async () => {
    expect(await firstElement(`<a:ln w="76200">${navy}</a:ln>`)).toMatchObject({ strokeWidth: 76200 })
    expect(await firstElement(`<a:ln w="12700">${navy}</a:ln>`)).toMatchObject({ strokeWidth: 12700 })
  })

  /** Omitting `w` means "inherit from the theme line styles", which we do not model — so no width. */
  it('omits the width when the source declares none', async () => {
    expect(await firstElement(`<a:ln>${navy}</a:ln>`)).not.toHaveProperty('strokeWidth')
  })

  it('ignores an unusable width', async () => {
    expect(await firstElement(`<a:ln w="wide">${navy}</a:ln>`)).not.toHaveProperty('strokeWidth')
    expect(await firstElement(`<a:ln w="-5">${navy}</a:ln>`)).not.toHaveProperty('strokeWidth')
  })

  it('reads a zero width, which OOXML uses for a hairline', async () => {
    expect(await firstElement(`<a:ln w="0">${navy}</a:ln>`)).toMatchObject({ strokeWidth: 0 })
  })

  it('reads the width of a shape that carries text', async () => {
    const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
      + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Labelled"/><p:nvPr/></p:nvSpPr>'
      + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
      + `<a:prstGeom prst="roundRect"/><a:ln w="38100">${navy}</a:ln></p:spPr>`
      + '<p:txBody><a:bodyPr/><a:p><a:r><a:t>Label</a:t></a:r></a:p></p:txBody></p:sp>'
      + '</p:spTree></p:cSld></p:sld>'
    const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': slide }))

    expect(document.elements.el_1).toMatchObject({ kind: 'text', strokeWidth: 38100 })
  })
})

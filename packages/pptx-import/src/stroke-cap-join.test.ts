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

describe('stroke cap on import', () => {
  /** Before this, four outlines differing only in cap and corner produced identical models. */
  it('reads the three cap words verbatim', async () => {
    for (const cap of ['flat', 'rnd', 'sq'] as const) {
      expect(await firstElement(`<a:ln w="76200" cap="${cap}">${navy}</a:ln>`)).toMatchObject({ strokeCap: cap })
    }
  })

  it('omits the cap when the source declares none', async () => {
    expect(await firstElement(`<a:ln w="76200">${navy}</a:ln>`)).not.toHaveProperty('strokeCap')
  })

  it('ignores an unrecognised cap', async () => {
    expect(await firstElement(`<a:ln w="76200" cap="pointy">${navy}</a:ln>`)).not.toHaveProperty('strokeCap')
  })
})

describe('stroke join on import', () => {
  /** The corner is a child element, so its name is the value. */
  it('reads each corner element', async () => {
    for (const join of ['round', 'bevel', 'miter'] as const) {
      expect(await firstElement(`<a:ln w="76200">${navy}<a:${join}/></a:ln>`)).toMatchObject({ strokeJoin: join })
    }
  })

  it('omits the join when the source declares none', async () => {
    expect(await firstElement(`<a:ln w="76200">${navy}</a:ln>`)).not.toHaveProperty('strokeJoin')
  })

  /** `a:miter/@lim` is not modeled, so the corner type survives but the limit does not. */
  it('reads a miter corner while dropping its limit', async () => {
    const element = await firstElement(`<a:ln w="76200">${navy}<a:miter lim="800000"/></a:ln>`)

    expect(element).toMatchObject({ strokeJoin: 'miter' })
    expect(JSON.stringify(element)).not.toContain('800000')
  })

  it('reads cap and join together on a shape that carries text', async () => {
    const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
      + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Labelled"/><p:nvPr/></p:nvSpPr>'
      + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
      + `<a:prstGeom prst="roundRect"/><a:ln w="76200" cap="rnd">${navy}<a:bevel/></a:ln></p:spPr>`
      + '<p:txBody><a:bodyPr/><a:p><a:r><a:t>Label</a:t></a:r></a:p></p:txBody></p:sp>'
      + '</p:spTree></p:cSld></p:sld>'
    const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': slide }))

    expect(document.elements.el_1).toMatchObject({ kind: 'text', strokeCap: 'rnd', strokeJoin: 'bevel' })
  })
})

import { describe, expect, it } from 'vitest'
import { importPptx } from './importer'
import { createStoredZip, files } from './test-fixtures'
import type { Ppt4aiDocument } from '@ppt4ai/model'

const navy = '<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>'

function shapeWith(effects: string, body = ''): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Shape"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"/>${navy}${effects}</p:spPr>${body}</p:sp>`
}

async function elementOf(markup: string): Promise<Ppt4aiDocument['elements'][string]> {
  const document = await importPptx(createStoredZip({
    ...files,
    'ppt/slides/slide1.xml': `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>${markup}</p:spTree></p:cSld></p:sld>`,
  }))
  const element = document.elements.el_1
  if (!element) throw new Error('fixture produced no element')
  return element
}

function shadowOf(element: Ppt4aiDocument['elements'][string]) {
  if (element.kind !== 'shape' && element.kind !== 'text') throw new Error('element cannot carry a shadow')
  return element.shadow
}

describe('outer shadow on import', () => {
  it('reads the colour and the three measurements', async () => {
    const effects = '<a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000"><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw></a:effectLst>'

    expect(shadowOf(await elementOf(shapeWith(effects)))).toEqual({
      color: { type: 'srgb', v: '000000', transforms: [{ type: 'alpha', value: 40000 }] },
      blurRadius: 50800,
      distance: 38100,
      direction: 2700000,
    })
  })

  it('reads a scheme colour and omits the measurements the source left out', async () => {
    const effects = '<a:effectLst><a:outerShdw><a:schemeClr val="tx1"/></a:outerShdw></a:effectLst>'

    expect(shadowOf(await elementOf(shapeWith(effects)))).toEqual({ color: { type: 'scheme', v: 'tx1' } })
  })

  it('reads a shadow on a text-carrying shape', async () => {
    const effects = '<a:effectLst><a:outerShdw dist="12700"><a:srgbClr val="203864"/></a:outerShdw></a:effectLst>'
    const element = await elementOf(shapeWith(effects, '<p:txBody><a:p><a:r><a:t>Titled</a:t></a:r></a:p></p:txBody>'))

    expect(element.kind).toBe('text')
    expect(shadowOf(element)).toEqual({ color: { type: 'srgb', v: '203864' }, distance: 12700 })
  })

  /** The three measurements describe where to put a colour, so without one there is no shadow. */
  it('drops a shadow with no usable colour', async () => {
    const effects = '<a:effectLst><a:outerShdw blurRad="50800" dist="38100"/></a:effectLst>'

    expect(shadowOf(await elementOf(shapeWith(effects)))).toBeUndefined()
  })

  it('ignores malformed measurements rather than the whole shadow', async () => {
    const effects = '<a:effectLst><a:outerShdw blurRad="soft" dist="-1" dir="bad"><a:srgbClr val="000000"/></a:outerShdw></a:effectLst>'

    expect(shadowOf(await elementOf(shapeWith(effects)))).toEqual({ color: { type: 'srgb', v: '000000' } })
  })

  it('leaves the other effects unmodeled', async () => {
    const effects = '<a:effectLst><a:glow rad="63500"><a:srgbClr val="FF0000"/></a:glow><a:softEdge rad="12700"/></a:effectLst>'

    expect(shadowOf(await elementOf(shapeWith(effects)))).toBeUndefined()
  })

  it('leaves a shape with no effect list alone', async () => {
    expect(shadowOf(await elementOf(shapeWith('')))).toBeUndefined()
  })
})

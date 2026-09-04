import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

function slideWith(fill: string): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Graded"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `<a:prstGeom prst="rect"/>${fill}</p:spPr></p:sp>`
    + '</p:spTree></p:cSld></p:sld>'
}

function gradient(stops: string, linear = '<a:lin ang="5400000" scaled="0"/>'): string {
  return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst>${linear}</a:gradFill>`
}

const twoStops = '<a:gs pos="0"><a:srgbClr val="4472C4"/></a:gs>'
  + '<a:gs pos="100000"><a:srgbClr val="203864"><a:alpha val="60000"/></a:srgbClr></a:gs>'

async function firstElement(fill: string) {
  const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': slideWith(fill) }))
  return document.elements.el_1
}

describe('linear gradient on import', () => {
  /** Before this the gradient was dropped whole: the element had no fill at all. */
  it('reads the stops, angle and scaled flag', async () => {
    expect(await firstElement(gradient(twoStops))).toMatchObject({
      fill: {
        color: { type: 'srgb', v: '4472C4' },
        gradient: {
          stops: [
            { pos: 0, color: { type: 'srgb', v: '4472C4' } },
            { pos: 100000, color: { type: 'srgb', v: '203864', transforms: [{ type: 'alpha', value: 60000 }] } },
          ],
          angle: 5400000,
          scaled: false,
        },
      },
    })
  })

  /** `color` carries the first stop so consumers that read only it paint flat, not nothing. */
  it('sets the fill colour to the first stop', async () => {
    const element = await firstElement(gradient(
      '<a:gs pos="30000"><a:schemeClr val="accent2"/></a:gs><a:gs pos="90000"><a:srgbClr val="000000"/></a:gs>',
    ))

    expect(element).toMatchObject({ fill: { color: { type: 'scheme', v: 'accent2' } } })
  })

  it('reads scaled="1" as true', async () => {
    expect(await firstElement(gradient(twoStops, '<a:lin ang="2700000" scaled="1"/>')))
      .toMatchObject({ fill: { gradient: { angle: 2700000, scaled: true } } })
  })

  it('omits the angle and flag the source does not declare', async () => {
    const element = await firstElement(gradient(twoStops, '<a:lin/>'))
    if (element?.kind !== 'shape' || !element.fill?.gradient) throw new Error('fixture did not import a gradient')

    expect(element.fill.gradient).not.toHaveProperty('angle')
    expect(element.fill.gradient).not.toHaveProperty('scaled')
  })

  /** PowerPoint paints a one-stop gradient flat, so the model says so rather than faking a ramp. */
  it('degrades a single usable stop to a plain colour', async () => {
    const element = await firstElement(gradient('<a:gs pos="0"><a:srgbClr val="4472C4"/></a:gs>'))

    expect(element).toMatchObject({ fill: { color: { type: 'srgb', v: '4472C4' } } })
    expect((element as { fill?: object }).fill).not.toHaveProperty('gradient')
  })

  it('drops a stop with an unusable position and keeps the rest', async () => {
    const element = await firstElement(gradient(
      '<a:gs pos="0"><a:srgbClr val="4472C4"/></a:gs>'
      + '<a:gs pos="way"><a:srgbClr val="FFFFFF"/></a:gs>'
      + '<a:gs pos="200000"><a:srgbClr val="000000"/></a:gs>'
      + '<a:gs pos="100000"><a:srgbClr val="203864"/></a:gs>',
    ))
    if (element?.kind !== 'shape' || !element.fill?.gradient) throw new Error('fixture did not import a gradient')

    expect(element.fill.gradient.stops).toEqual([
      { pos: 0, color: { type: 'srgb', v: '4472C4' } },
      { pos: 100000, color: { type: 'srgb', v: '203864' } },
    ])
  })

  it('produces no fill when no stop is usable', async () => {
    expect(await firstElement(gradient('<a:gs pos="0"/>'))).not.toHaveProperty('fill')
  })

  /** `a:path` gradients are modeled now; the form and its stops both reach the model. */
  it('reads a path gradient rather than dropping the fill', async () => {
    const element = await firstElement(`<a:gradFill><a:gsLst>${twoStops}</a:gsLst><a:path path="circle"/></a:gradFill>`)
    if (element?.kind !== 'shape' || !element.fill?.gradient) throw new Error('fixture did not import a gradient')

    expect(element.fill.gradient.path).toBe('circle')
    expect(element.fill.gradient.stops).toHaveLength(2)
  })

  /** Stop order is the source's, because sorting would quietly repair a malformed file. */
  it('keeps the source order of the stops', async () => {
    const element = await firstElement(gradient(
      '<a:gs pos="100000"><a:srgbClr val="000000"/></a:gs><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs>',
    ))
    if (element?.kind !== 'shape' || !element.fill?.gradient) throw new Error('fixture did not import a gradient')

    expect(element.fill.gradient.stops.map((stop) => stop.pos)).toEqual([100000, 0])
  })

  it('reads a gradient on a shape that carries text', async () => {
    const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
      + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Labelled"/><p:nvPr/></p:nvSpPr>'
      + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
      + `<a:prstGeom prst="roundRect"/>${gradient(twoStops)}</p:spPr>`
      + '<p:txBody><a:bodyPr/><a:p><a:r><a:t>Label</a:t></a:r></a:p></p:txBody></p:sp>'
      + '</p:spTree></p:cSld></p:sld>'
    const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': slide }))

    expect(document.elements.el_1).toMatchObject({ kind: 'text', fill: { gradient: { angle: 5400000 } } })
  })
})

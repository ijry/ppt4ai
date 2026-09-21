import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

/** A `a:gradFill` whose form element is whatever the case under test needs. */
function shapeWithGradient(form: string): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Radial"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="500000"/></a:xfrm><a:prstGeom prst="rect"/>'
    + '<a:gradFill><a:gsLst>'
    + '<a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs>'
    + '<a:gs pos="100000"><a:srgbClr val="4472C4"/></a:gs>'
    + `</a:gsLst>${form}</a:gradFill></p:spPr>`
    + '<p:txBody><a:p><a:r><a:t>Radial</a:t></a:r></a:p></p:txBody></p:sp>'
    + '</p:spTree></p:cSld></p:sld>'
}

async function fillOf(form: string) {
  const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': shapeWithGradient(form) }))
  const element = document.elements.el_1
  if (element?.kind !== 'text' && element?.kind !== 'shape') throw new Error('fixture did not import as a shape or text')
  return element.fill
}

describe('path gradient import', () => {
  it('reads the path word and the convergence rect', async () => {
    const fill = await fillOf('<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>')

    expect(fill?.gradient).toEqual({
      stops: [{ pos: 0, color: { type: 'srgb', v: 'FFFFFF' } }, { pos: 100000, color: { type: 'srgb', v: '4472C4' } }],
      path: 'circle',
      fillToRect: { left: 50000, top: 50000, right: 50000, bottom: 50000 },
    })
    expect(fill?.color).toEqual({ type: 'srgb', v: 'FFFFFF' })
  })

  it('reads the other two path words as authored', async () => {
    expect((await fillOf('<a:path path="rect"/>'))?.gradient?.path).toBe('rect')
    expect((await fillOf('<a:path path="shape"/>'))?.gradient?.path).toBe('shape')
  })

  /** The stops used to be thrown away with the form, leaving the shape with no fill at all. */
  it('keeps the stops even when the path word is missing or unknown', async () => {
    const unknown = await fillOf('<a:path path="spiral"/>')
    const missing = await fillOf('<a:path/>')

    expect(unknown?.gradient?.stops).toHaveLength(2)
    expect(unknown?.gradient?.path).toBeUndefined()
    expect(missing?.gradient?.stops).toHaveLength(2)
  })

  it('drops a rect side outside the modeled range and keeps the rest', async () => {
    const fill = await fillOf('<a:path path="circle"><a:fillToRect l="50000" t="-1" r="200000" b="0"/></a:path>')

    expect(fill?.gradient?.fillToRect).toEqual({ left: 50000, bottom: 0 })
  })

  it('leaves a linear gradient reading exactly as before', async () => {
    const fill = await fillOf('<a:lin ang="5400000" scaled="1"/>')

    expect(fill?.gradient).toEqual({
      stops: [{ pos: 0, color: { type: 'srgb', v: 'FFFFFF' } }, { pos: 100000, color: { type: 'srgb', v: '4472C4' } }],
      angle: 5400000,
      scaled: true,
    })
  })

  it('still gives no gradient when the fill states neither form', async () => {
    expect(await fillOf('')).toBeUndefined()
  })
})

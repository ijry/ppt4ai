import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

function shapeWith(geometry: string, textBody: string): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Shape"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `${geometry}<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></p:spPr>${textBody}</p:sp>`
    + '</p:spTree></p:cSld></p:sld>'
}

/** What PowerPoint writes for a shape the user never typed into. */
const emptyTextBody = '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody>'
const labelTextBody = '<p:txBody><a:bodyPr/><a:p><a:r><a:t>Label</a:t></a:r></a:p></p:txBody>'

async function firstElement(slide: string) {
  const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': slide }))
  return document.elements.el_1
}

describe('geometry on shapes that carry text', () => {
  /**
   * PowerPoint writes a `p:txBody` on every shape, so before this every rounded rectangle, ellipse
   * and callout in a real deck imported as a bare text element and lost its geometry.
   */
  it('keeps the preset when the shape has an empty text body', async () => {
    expect(await firstElement(shapeWith('<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>', emptyTextBody)))
      .toMatchObject({ kind: 'text', preset: 'roundRect', fill: { color: { type: 'srgb', v: '4472C4' } } })
  })

  it('keeps the preset when the shape has a label', async () => {
    expect(await firstElement(shapeWith('<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>', labelTextBody)))
      .toMatchObject({ kind: 'text', preset: 'ellipse', text: 'Label' })
  })

  it('reads every supported preset', async () => {
    for (const preset of ['rect', 'roundRect', 'ellipse', 'triangle'] as const) {
      expect(await firstElement(shapeWith(`<a:prstGeom prst="${preset}"/>`, labelTextBody))).toMatchObject({ preset })
    }
  })

  /** A plain text box declares no geometry, and the model should not invent one for it. */
  it('omits the preset when the source declares no geometry', async () => {
    const element = await firstElement(shapeWith('', labelTextBody))

    expect(element).toMatchObject({ kind: 'text' })
    expect(element).not.toHaveProperty('preset')
  })

  it('falls back to rect for an unsupported preset, as shapes already did', async () => {
    expect(await firstElement(shapeWith('<a:prstGeom prst="hexagon"/>', labelTextBody))).toMatchObject({ preset: 'rect' })
  })

  it('still imports a shape without a text body as a shape', async () => {
    expect(await firstElement(shapeWith('<a:prstGeom prst="triangle"/>', ''))).toMatchObject({ kind: 'shape', preset: 'triangle' })
  })
})

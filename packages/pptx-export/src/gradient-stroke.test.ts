import { importPptx } from '@ppt4ai/pptx-import'
import type { Fill, Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx, exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

const sourceGradientLine = '<a:ln w="76200" cap="rnd"><a:gradFill rotWithShape="1"><a:gsLst>'
  + '<a:gs pos="0"><a:srgbClr val="4472C4"/></a:gs>'
  + '<a:gs pos="100000"><a:srgbClr val="ED7D31"/></a:gs>'
  + '</a:gsLst><a:lin ang="0" scaled="0"/></a:gradFill></a:ln>'

function sourcePackage(): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Graded outline"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `<a:prstGeom prst="rect"/>${sourceGradientLine}</p:spPr></p:sp>`
    + '</p:spTree></p:cSld></p:sld>'
  const encode = (value: string) => new TextEncoder().encode(value)
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: encode(slide) },
  ])
}

async function slideXmlOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  const data = entries.get('ppt/slides/slide1.xml')
  if (!data) throw new Error('missing slide')
  return new TextDecoder().decode(data)
}

const gradientStroke: Fill = {
  color: { type: 'srgb', v: '4472C4' },
  gradient: {
    stops: [
      { pos: 0, color: { type: 'srgb', v: '4472C4' } },
      { pos: 100000, color: { type: 'srgb', v: 'ED7D31' } },
    ],
    angle: 0,
    scaled: false,
  },
}

/**
 * The design predicted export and writeback already handle a gradient outline, because
 * `serializeFillXml` and `sourceFill` both learned about `gradFill` in the linear gradient slice.
 * These assert that rather than assuming it — the previous slice's lesson.
 */
describe('gradient stroke on the write paths', () => {
  it('leaves an unedited package byte-identical', async () => {
    const source = sourcePackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  it('keeps the source gradient outline when only the width changes', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const shape = document.elements.el_1
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    shape.strokeWidth = 38100

    const outputSlide = await slideXmlOf(await exportPptx(document, source))

    expect(outputSlide).toContain('<a:gradFill rotWithShape="1">')
    expect(outputSlide).toContain('w="38100"')
    expect(outputSlide).toContain('cap="rnd"')
  })

  it('writes a gradient outline on standalone export and reads it back', async () => {
    const document: Ppt4aiDocument = {
      format: 'ppt4ai',
      version: 1,
      id: 'dck_gradient_stroke',
      page: { w: 12192000, h: 6858000 },
      slides: { sld_1: { id: 'sld_1', elementIds: ['shape_1'] } },
      slideOrder: ['sld_1'],
      elements: {
        shape_1: {
          id: 'shape_1',
          kind: 'shape',
          preset: 'rect',
          bounds: { x: 0, y: 0, w: 2000000, h: 1000000 },
          stroke: gradientStroke,
          strokeWidth: 76200,
        },
      },
    }

    const bytes = await createPptx(document)
    expect(await slideXmlOf(bytes)).toContain('<a:ln w="76200"><a:gradFill><a:gsLst>')

    const imported = await importPptx(bytes)
    const id = imported.slides.sld_1?.elementIds[0] ?? ''
    expect(imported.elements[id]).toMatchObject({ kind: 'shape', stroke: gradientStroke, strokeWidth: 76200 })
  })
})

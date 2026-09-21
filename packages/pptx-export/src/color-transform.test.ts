import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { createPptx, exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
/** Office's own combination, plus one transform the resolver keeps but cannot compute. */
const sourceColor = '<a:schemeClr val="accent1"><a:lumMod val="75000"/><a:satMod val="160000"/><a:comp/><a:hueOff val="600000"/></a:schemeClr>'

function sourcePackage(): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Filled"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `<a:prstGeom prst="rect"/><a:solidFill>${sourceColor}</a:solidFill></p:spPr></p:sp>`
    + '</p:spTree></p:cSld></p:sld>'
  const encode = (value: string): Uint8Array => new TextEncoder().encode(value)
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: encode(slide) },
  ])
}

async function slideOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  return new TextDecoder().decode(entries.get('ppt/slides/slide1.xml')!)
}

async function shapeOf(bytes: Uint8Array) {
  const document = await importPptx(bytes)
  const shape = document.elements[document.slides.sld_1?.elementIds[0] ?? ''] ?? document.elements.el_1
  if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
  return { document, shape }
}

describe('colour transforms survive the round trip', () => {
  it('imports every transform the colour lists, valued and switch-shaped alike', async () => {
    const { shape } = await shapeOf(sourcePackage())

    // `comp` joined this list when the switch-shaped transforms were modeled; before that a required
    // `value` dropped it, and standalone generation wrote the colour without it.
    expect(shape.fill?.color.transforms).toEqual([
      { type: 'lumMod', value: 75000 },
      { type: 'satMod', value: 160000 },
      { type: 'comp' },
      { type: 'hueOff', value: 600000 },
    ])
  })

  it('stays byte-identical when nothing is edited', async () => {
    const source = sourcePackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  /** `satMod` used to be dropped on import, so an unrelated edit rewrote the colour without it. */
  it('keeps the transforms through an unrelated edit', async () => {
    const source = sourcePackage()
    const { document, shape } = await shapeOf(source)
    shape.bounds = { ...shape.bounds, x: 3000000 }

    const xml = await slideOf(await exportPptx(document, source))

    expect(xml).toContain(sourceColor)
    expect(xml).toContain('<a:off x="3000000" y="1000000"/>')
  })

  it('writes every transform in standalone generation and reads them back', async () => {
    const { document } = await shapeOf(sourcePackage())

    const output = await createPptx(document)
    const xml = await slideOf(output)

    expect(xml).toContain('<a:lumMod val="75000"/>')
    expect(xml).toContain('<a:satMod val="160000"/>')
    expect(xml).toContain('<a:hueOff val="600000"/>')
    expect((await shapeOf(output)).shape.fill?.color.transforms).toEqual([
      { type: 'lumMod', value: 75000 },
      { type: 'satMod', value: 160000 },
      { type: 'comp' },
      { type: 'hueOff', value: 600000 },
    ])
  })

  /** A recoloured shape must still be written: the comparison sees both sides' full transform lists. */
  it('writes a changed colour whose transforms differ', async () => {
    const source = sourcePackage()
    const { document, shape } = await shapeOf(source)
    shape.fill = { color: { type: 'scheme', v: 'accent1', transforms: [{ type: 'satMod', value: 120000 }] } }

    const xml = await slideOf(await exportPptx(document, source))

    expect(xml).toContain('<a:satMod val="120000"/>')
    expect(xml).not.toContain('<a:lumMod val="75000"/>')
  })
})

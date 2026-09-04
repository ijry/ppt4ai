import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { createPptx, exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
/** Switches before and after a valued transform, so the order is observable. */
const sourceColor = '<a:srgbClr val="4472C4"><a:gray/><a:lumMod val="75000"/><a:inv/><a:comp/></a:srgbClr>'

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

/** The last hole on the collapse line: these three carry no `val`, so a required value dropped them. */
describe('switch-shaped colour transforms', () => {
  it('imports them in order, without a value', async () => {
    const { shape } = await shapeOf(sourcePackage())

    expect(shape.fill?.color.transforms).toEqual([
      { type: 'gray' },
      { type: 'lumMod', value: 75000 },
      { type: 'inv' },
      { type: 'comp' },
    ])
  })

  it('writes them back with no attribute in standalone generation', async () => {
    const { document } = await shapeOf(sourcePackage())
    const output = await createPptx(document)

    expect(await slideOf(output)).toContain('<a:srgbClr val="4472C4"><a:gray/><a:lumMod val="75000"/><a:inv/><a:comp/></a:srgbClr>')
    expect((await shapeOf(output)).shape.fill?.color.transforms).toEqual([
      { type: 'gray' },
      { type: 'lumMod', value: 75000 },
      { type: 'inv' },
      { type: 'comp' },
    ])
  })

  it('stays byte-identical when nothing is edited', async () => {
    const source = sourcePackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  it('keeps them through an unrelated edit', async () => {
    const source = sourcePackage()
    const { document, shape } = await shapeOf(source)
    shape.bounds = { ...shape.bounds, x: 3000000 }

    const xml = await slideOf(await exportPptx(document, source))

    expect(xml).toContain(sourceColor)
    expect(xml).toContain('<a:off x="3000000" y="1000000"/>')
  })

  /** Dropping a switch is a real change, so the writeback must notice it rather than compare equal. */
  it('writes the colour when a switch is removed from the model', async () => {
    const source = sourcePackage()
    const { document, shape } = await shapeOf(source)
    shape.fill = { color: { type: 'srgb', v: '4472C4', transforms: [{ type: 'lumMod', value: 75000 }] } }

    const xml = await slideOf(await exportPptx(document, source))

    expect(xml).toContain('<a:srgbClr val="4472C4"><a:lumMod val="75000"/></a:srgbClr>')
    expect(xml).not.toContain('<a:gray/>')
  })
})

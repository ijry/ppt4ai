import { importPptx } from '@ppt4ai/pptx-import'
import type { AssetAdapter } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx, exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x10,
  0x08, 0x06, 0x00, 0x00, 0x00,
])

const adapter: AssetAdapter = { get: async (): Promise<Uint8Array> => pngBytes, put: async (): Promise<void> => {} }

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const slideRels = '<Relationships xmlns="r"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/photo.png"/></Relationships>'
const cellFill = '<a:blipFill><a:blip r:embed="rId2"/><a:srcRect l="10000"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>'

function sourcePackage(): Uint8Array {
  const table = '<a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="1000000"/></a:tblGrid>'
    + `<a:tr h="500000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Photo</a:t></a:r></a:p></a:txBody><a:tcPr>${cellFill}</a:tcPr></a:tc></a:tr></a:tbl>`
  const slide = '<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>'
    + '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
    + '<p:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="500000"/></p:xfrm>'
    + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">${table}</a:graphicData></a:graphic></p:graphicFrame>`
    + '</p:spTree></p:cSld></p:sld>'
  const encode = (value: string): Uint8Array => new TextEncoder().encode(value)
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: encode(slide) },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: encode(slideRels) },
    { name: 'ppt/media/photo.png', data: pngBytes },
  ])
}

async function slideOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  return new TextDecoder().decode(entries.get('ppt/slides/slide1.xml')!)
}

async function tableOf(bytes: Uint8Array) {
  const document = await importPptx(bytes)
  const element = document.elements[document.slides.sld_1?.elementIds[0] ?? ''] ?? document.elements.el_1
  if (element?.kind !== 'table') throw new Error('fixture did not import as a table')
  return { document, table: element }
}

describe('table cell picture fill', () => {
  it('imports the cell fill and registers its media once', async () => {
    const { document, table } = await tableOf(sourcePackage())

    expect(table.rows[0]?.cells[0]?.pictureFill).toEqual({
      assetId: 'asset_ppt_media_photo_png',
      sourceCrop: { left: 10000 },
    })
    expect(Object.keys(document.assets ?? {})).toEqual(['asset_ppt_media_photo_png'])
  })

  /**
   * The table is rebuilt wholesale on the writeback path, so without carrying the source's relationship
   * ids the cell's photo would simply disappear on any edit.
   */
  it('keeps the cell photo when the table is re-serialized', async () => {
    const source = sourcePackage()
    const { document, table } = await tableOf(source)
    table.rows[0]!.cells[0]!.body = { paragraphs: [{ runs: [{ text: 'Edited' }] }] }

    const xml = await slideOf(await exportPptx(document, source))

    expect(xml).toContain('<a:blipFill><a:blip r:embed="rId2"/><a:srcRect l="10000"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>')
    expect(xml).toContain('Edited')
  })

  it('stays byte-identical when nothing is edited', async () => {
    const source = sourcePackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  it('writes the cell fill, its media and relationship in standalone generation', async () => {
    const { document } = await tableOf(sourcePackage())

    const output = await createPptx(document, { assetAdapter: adapter })
    const entries = new Map((await readZipEntries(output)).map((entry) => [entry.name, entry.data]))

    expect(await slideOf(output)).toContain('<a:blipFill><a:blip r:embed="rId2"/><a:srcRect l="10000"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>')
    expect(entries.get('ppt/media/image1.png')).toEqual(pngBytes)
    expect((await tableOf(output)).table.rows[0]?.cells[0]?.pictureFill?.sourceCrop).toEqual({ left: 10000 })
  })
})

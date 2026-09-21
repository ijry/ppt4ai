import { importPptx } from '@ppt4ai/pptx-import'
import type { AssetAdapter, Ppt4aiDocument, ShapeElement } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx, exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x10,
  0x08, 0x06, 0x00, 0x00, 0x00,
])

const adapter: AssetAdapter = {
  get: async (): Promise<Uint8Array> => pngBytes,
  put: async (): Promise<void> => {},
}

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const slideRels = '<Relationships xmlns="r"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/photo.png"/></Relationships>'
/** Negative left and right: PowerPoint's "fill" crop pushes the picture past the frame. */
const sourceFill = '<a:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect l="-10000" t="5000" r="-10000" b="5000"/></a:stretch></a:blipFill>'

function sourcePackage(): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Filled"/><p:nvPr/></p:nvSpPr>'
    + `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"/>${sourceFill}</p:spPr></p:sp>`
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

async function shapeOf(bytes: Uint8Array) {
  const document = await importPptx(bytes)
  const shape = document.elements[document.slides.sld_1?.elementIds[0] ?? ''] ?? document.elements.el_1
  if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
  return { document, shape }
}

function documentWith(shape: ShapeElement): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_stretch_rect',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [shape.id] } },
    slideOrder: ['sld_1'],
    elements: { [shape.id]: shape },
    assets: { asset_photo: { id: 'asset_photo', mimeType: 'image/png', pixelWidth: 32, pixelHeight: 16 } },
  }
}

describe('picture stretch rect', () => {
  it('imports all four signed insets', async () => {
    const { shape } = await shapeOf(sourcePackage())

    expect(shape.pictureFill).toEqual({
      assetId: 'asset_ppt_media_photo_png',
      stretch: { left: -10000, top: 5000, right: -10000, bottom: 5000 },
    })
  })

  it('leaves the field absent for a plain fillRect', async () => {
    const plain = sourcePackage()
    const document = await importPptx(plain)
    // The fixture above always has insets, so this asserts the shape of the *other* fixture kind.
    expect(document.slides.sld_1).toBeDefined()

    const bare = '<a:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>'
    const source = new TextDecoder().decode((await readZipEntries(plain)).find((entry) => entry.name.endsWith('slide1.xml'))!.data)
    const rebuilt = writeStoredZip([
      { name: 'ppt/presentation.xml', data: new TextEncoder().encode(presentation) },
      { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode(presentationRels) },
      { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode(source.replace(sourceFill, bare)) },
      { name: 'ppt/slides/_rels/slide1.xml.rels', data: new TextEncoder().encode(slideRels) },
      { name: 'ppt/media/photo.png', data: pngBytes },
    ])

    expect((await shapeOf(rebuilt)).shape.pictureFill).not.toHaveProperty('stretch')
  })

  it('writes the insets in standalone generation and reads them back', async () => {
    const shape: ShapeElement = {
      id: 'shape_1',
      kind: 'shape',
      preset: 'rect',
      bounds: { x: 0, y: 0, w: 2000000, h: 1000000 },
      pictureFill: { assetId: 'asset_photo', stretch: { left: -10000, bottom: 5000 } },
    }

    const output = await createPptx(documentWith(shape), { assetAdapter: adapter })

    expect(await slideOf(output)).toContain('<a:stretch><a:fillRect l="-10000" b="5000"/></a:stretch>')
    expect((await shapeOf(output)).shape.pictureFill?.stretch).toEqual({ left: -10000, bottom: 5000 })
  })

  it('stays byte-identical when nothing is edited', async () => {
    const source = sourcePackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  /** `a:fillRect` belongs to `a:stretch`, so a tiled fill never records or writes one. */
  it('does not record a stretch rect for a tiled fill', async () => {
    const tiled: ShapeElement = {
      id: 'shape_1',
      kind: 'shape',
      preset: 'rect',
      bounds: { x: 0, y: 0, w: 2000000, h: 1000000 },
      pictureFill: { assetId: 'asset_photo', tile: { align: 'tl' } },
    }

    const xml = await slideOf(await createPptx(documentWith(tiled), { assetAdapter: adapter }))

    expect(xml).toContain('<a:tile algn="tl"/>')
    expect(xml).not.toContain('fillRect')
  })
})

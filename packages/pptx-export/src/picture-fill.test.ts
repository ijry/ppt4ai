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

class RecordingAdapter implements AssetAdapter {
  readonly requests: string[] = []
  constructor(private readonly assets: Map<string, Uint8Array>) {}
  async get(assetId: string): Promise<Uint8Array | undefined> {
    this.requests.push(assetId)
    return this.assets.get(assetId)
  }
  async put(): Promise<void> {}
}

function adapterWithPng(): RecordingAdapter {
  return new RecordingAdapter(new Map([['asset_photo', pngBytes]]))
}

const filledShape: ShapeElement = {
  id: 'shape_1',
  kind: 'shape',
  preset: 'roundRect',
  bounds: { x: 1000000, y: 500000, w: 3000000, h: 1500000 },
  pictureFill: { assetId: 'asset_photo' },
  stroke: { color: { type: 'srgb', v: '203864' } },
}

function documentWith(...elements: Ppt4aiDocument['elements'][string][]): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_picture_fill',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: elements.map((element) => element.id) } },
    slideOrder: ['sld_1'],
    elements: Object.fromEntries(elements.map((element) => [element.id, element])),
    assets: { asset_photo: { id: 'asset_photo', mimeType: 'image/png', pixelWidth: 32, pixelHeight: 16 } },
  }
}

async function entriesOf(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  return new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
}

async function slideXml(bytes: Uint8Array): Promise<string> {
  const data = (await entriesOf(bytes)).get('ppt/slides/slide1.xml')
  if (!data) throw new Error('missing generated slide')
  return new TextDecoder().decode(data)
}

describe('picture fill standalone generation', () => {
  it('writes the blip fill, its media part and a slide-local relationship', async () => {
    const document = documentWith(filledShape)
    const before = structuredClone(document)
    const adapter = adapterWithPng()

    const output = await createPptx(document, { assetAdapter: adapter })
    const repeated = await createPptx(structuredClone(document), { assetAdapter: adapterWithPng() })
    const entries = await entriesOf(output)
    const xml = await slideXml(output)

    expect(xml).toContain('<a:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>')
    expect(entries.get('ppt/media/image1.png')).toEqual(pngBytes)
    expect(new TextDecoder().decode(entries.get('ppt/slides/_rels/slide1.xml.rels'))).toContain('Id="rId2"')
    expect(new TextDecoder().decode(entries.get('[Content_Types].xml'))).toContain('Extension="png"')
    expect(adapter.requests).toEqual(['asset_photo'])
    expect(output).toEqual(repeated)
    expect(document).toEqual(before)
  })

  it('round-trips through the importer', async () => {
    const output = await createPptx(documentWith(filledShape), { assetAdapter: adapterWithPng() })

    const imported = await importPptx(output)
    const shape = imported.elements[imported.slides.sld_1?.elementIds[0] ?? '']
    if (shape?.kind !== 'shape') throw new Error('the generated shape did not import as a shape')

    expect(shape.pictureFill).toEqual({ assetId: 'asset_ppt_media_image1_png' })
    expect(imported.assets?.asset_ppt_media_image1_png).toMatchObject({ mimeType: 'image/png', pixelWidth: 32, pixelHeight: 16 })
  })

  it('writes the source crop', async () => {
    const cropped: ShapeElement = { ...filledShape, pictureFill: { assetId: 'asset_photo', sourceCrop: { left: 10000, bottom: 20000 } } }

    const xml = await slideXml(await createPptx(documentWith(cropped), { assetAdapter: adapterWithPng() }))

    expect(xml).toContain('<a:srcRect l="10000" b="20000"/>')
  })

  /** One media part and one relationship: the shape fill and the picture point at the same asset. */
  it('shares one media part with a picture using the same asset', async () => {
    const document = documentWith(filledShape, {
      id: 'image_1',
      kind: 'image',
      bounds: { x: 5000000, y: 500000, w: 2000000, h: 1000000 },
      assetId: 'asset_photo',
    })
    const adapter = adapterWithPng()

    const output = await createPptx(document, { assetAdapter: adapter })
    const entries = await entriesOf(output)
    const relationships = new TextDecoder().decode(entries.get('ppt/slides/_rels/slide1.xml.rels'))

    expect(adapter.requests).toEqual(['asset_photo'])
    expect([...entries.keys()].filter((name) => name.startsWith('ppt/media/'))).toEqual(['ppt/media/image1.png'])
    expect(relationships).not.toContain('rId3')
  })

  it('reports the missing adapter with the asset the fill needs', async () => {
    await expect(createPptx(documentWith(filledShape))).rejects.toThrow('PPTX generation asset adapter missing: asset_photo')
  })

  it('writes a colour fill instead when the shape has no picture', async () => {
    const coloured: ShapeElement = { ...filledShape, fill: { color: { type: 'srgb', v: '4472C4' } } }
    delete coloured.pictureFill

    const xml = await slideXml(await createPptx(documentWith(coloured), { assetAdapter: adapterWithPng() }))

    expect(xml).toContain('<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>')
    expect(xml).not.toContain('blipFill')
  })
})

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const slideRels = '<Relationships xmlns="r"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/photo.png"/></Relationships>'
const sourceFill = '<a:blipFill rotWithShape="1" data-keep="yes"><a:blip r:embed="rId2"><a:alphaModFix amt="50000"/></a:blip><a:stretch><a:fillRect l="-5000"/></a:stretch></a:blipFill>'

function sourcePackage(): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Filled"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `<a:prstGeom prst="rect"/>${sourceFill}<a:ln w="12700"><a:solidFill><a:srgbClr val="203864"/></a:solidFill></a:ln></p:spPr></p:sp>`
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

async function sourceShape(source: Uint8Array) {
  const document = await importPptx(source)
  const shape = document.elements.el_1
  if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
  return { document, shape }
}

/**
 * The reason the picture lives outside `Fill` (decision 1): the model keeps `fill` absent, so the
 * writeback's fill comparison still sees "no fill" on both sides and never rewrites the blip.
 */
describe('picture fill source writeback', () => {
  it('stays byte-identical when nothing is edited', async () => {
    const source = sourcePackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  it('keeps the source blip fill verbatim through an unrelated edit', async () => {
    const source = sourcePackage()
    const { document, shape } = await sourceShape(source)
    shape.bounds = { ...shape.bounds, x: 3000000 }

    const xml = new TextDecoder().decode((await entriesOf(await exportPptx(document, source))).get('ppt/slides/slide1.xml')!)

    expect(xml).toContain(sourceFill)
    expect(xml).toContain('<a:off x="3000000" y="1000000"/>')
  })

  /** What the engine command produces: the picture cleared, a colour set. The blip node goes with it. */
  it('replaces the blip fill when the model switches to a colour', async () => {
    const source = sourcePackage()
    const { document, shape } = await sourceShape(source)
    delete shape.pictureFill
    shape.fill = { color: { type: 'srgb', v: '4472C4' } }

    const xml = new TextDecoder().decode((await entriesOf(await exportPptx(document, source))).get('ppt/slides/slide1.xml')!)

    expect(xml).toContain('<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>')
    expect(xml).not.toContain('blipFill')
    expect(xml).toContain('<a:ln w="12700">')
  })
})

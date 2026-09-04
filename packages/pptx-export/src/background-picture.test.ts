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

const adapter: AssetAdapter = {
  get: async (): Promise<Uint8Array> => pngBytes,
  put: async (): Promise<void> => {},
}

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const slideRels = '<Relationships xmlns="r"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/photo.png"/></Relationships>'
const pictureBackground = '<p:bg><p:bgPr data-keep="yes"><a:blipFill><a:blip r:embed="rId2"><a:alphaModFix amt="60000"/></a:blip><a:srcRect l="5000"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>'

function sourcePackage(): Uint8Array {
  const slide = `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld>${pictureBackground}<p:spTree>`
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Box"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:sp>'
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

describe('photo slide background', () => {
  it('imports the fill with its crop and effects, and registers the media', async () => {
    const document = await importPptx(sourcePackage())

    expect(document.slides.sld_1?.background?.pictureFill).toEqual({
      assetId: 'asset_ppt_media_photo_png',
      sourceCrop: { left: 5000 },
      effects: [{ type: 'alphaModFix', amount: 60000 }],
    })
    expect(document.assets?.asset_ppt_media_photo_png).toMatchObject({ mimeType: 'image/png' })
  })

  it('writes the background, its media and its relationship in standalone generation', async () => {
    const document = await importPptx(sourcePackage())

    const output = await createPptx(document, { assetAdapter: adapter })
    const entries = new Map((await readZipEntries(output)).map((entry) => [entry.name, entry.data]))
    const xml = await slideOf(output)

    expect(xml).toContain('<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rId2"><a:alphaModFix amt="60000"/></a:blip><a:srcRect l="5000"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>')
    expect(entries.get('ppt/media/image1.png')).toEqual(pngBytes)
    expect(new TextDecoder().decode(entries.get('ppt/slides/_rels/slide1.xml.rels'))).toContain('Target="../media/image1.png"')
    expect((await importPptx(output)).slides.sld_1?.background?.pictureFill?.sourceCrop).toEqual({ left: 5000 })
  })

  /** Without the asset-aware comparison the writeback would rewrite `p:bg` and destroy the photo. */
  it('keeps the photo background verbatim through an unrelated edit', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const element = document.elements.el_1
    if (element?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    element.bounds = { ...element.bounds, x: 500000 }

    const xml = await slideOf(await exportPptx(document, source))

    expect(xml).toContain(pictureBackground)
  })

  it('stays byte-identical when nothing is edited', async () => {
    const source = sourcePackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  /** Picking a colour on a photo background is a real change, so the whole node is replaced. */
  it('replaces the photo with a colour the user picked', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    document.slides.sld_1!.background = { fill: { color: { type: 'srgb', v: 'FF0000' } } }

    const xml = await slideOf(await exportPptx(document, source))

    expect(xml).toContain('<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>')
    expect(xml).not.toContain('blipFill')
  })

  it('shares one media part with a picture that uses the same photo', async () => {
    const document = await importPptx(sourcePackage())
    document.elements.el_2 = {
      id: 'el_2',
      kind: 'image',
      bounds: { x: 0, y: 0, w: 100, h: 100 },
      assetId: 'asset_ppt_media_photo_png',
    }
    document.slides.sld_1!.elementIds = [...document.slides.sld_1!.elementIds, 'el_2']

    const output = await createPptx(document, { assetAdapter: adapter })
    const entries = new Map((await readZipEntries(output)).map((entry) => [entry.name, entry.data]))

    expect([...entries.keys()].filter((name) => name.startsWith('ppt/media/'))).toEqual(['ppt/media/image1.png'])
  })
})

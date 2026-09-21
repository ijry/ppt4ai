import { importPptx } from '@ppt4ai/pptx-import'
import type { AssetAdapter, AssetMetadata, Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x10,
  0x08, 0x06, 0x00, 0x00, 0x00,
])

const adapter: AssetAdapter = { get: async (): Promise<Uint8Array> => pngBytes, put: async (): Promise<void> => {} }
const metadata: AssetMetadata = { id: 'asset_new', mimeType: 'image/png' }

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const contentTypes = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>'
const colourBackground = '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>'

function sourcePackage(background = colourBackground): Uint8Array {
  const slide = `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld>${background}<p:spTree>`
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Box"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:sp>'
    + '</p:spTree></p:cSld></p:sld>'
  const encode = (value: string): Uint8Array => new TextEncoder().encode(value)
  return writeStoredZip([
    { name: '[Content_Types].xml', data: encode(contentTypes) },
    { name: 'ppt/presentation.xml', data: encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: encode(slide) },
  ])
}

async function partsOf(bytes: Uint8Array): Promise<Map<string, string>> {
  const decoder = new TextDecoder()
  return new Map((await readZipEntries(bytes)).map((entry) => [entry.name, decoder.decode(entry.data)]))
}
async function rawParts(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  return new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
}

describe('slide picture background writeback', () => {
  it('materializes media, adds a relationship and writes the blipFill when a picture background is introduced', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    document.assets = { ...(document.assets ?? {}), asset_new: metadata }
    document.slides.sld_1!.background = { pictureFill: { assetId: 'asset_new', sourceCrop: { left: 5000 } } }

    const output = await exportPptx(document, source, { assetAdapter: adapter })
    const parts = await partsOf(output)
    const raw = await rawParts(output)
    const slideXml = parts.get('ppt/slides/slide1.xml')!
    const rels = parts.get('ppt/slides/_rels/slide1.xml.rels') ?? ''

    // A media part is written and referenced from a new slide relationship, and the blip embeds it.
    const media = [...raw.keys()].filter((name) => name.startsWith('ppt/media/'))
    expect(media).toHaveLength(1)
    expect(rels).toContain('relationships/image')
    expect(slideXml).toContain('<a:blipFill>')
    expect(slideXml).toContain('<a:srcRect l="5000"/>')
    expect(slideXml).not.toContain('<a:solidFill>')
    // And it round-trips back to a picture background.
    expect((await importPptx(output)).slides.sld_1?.background?.pictureFill?.sourceCrop).toEqual({ left: 5000 })
  })

  it('stays byte-identical when nothing is edited', async () => {
    const source = sourcePackage()
    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })
})

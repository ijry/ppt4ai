import { importPptx } from '@ppt4ai/pptx-import'
import type { AssetAdapter, AssetMetadata } from '@ppt4ai/model'
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

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const contentTypes = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/></Types>'

const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
  + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="B"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="10" cy="10"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:sp>'
  + '</p:spTree></p:cSld></p:sld>'
const layout = '<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree/></p:cSld></p:sldLayout>'
const master = '<p:sldMaster xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree/></p:cSld></p:sldMaster>'

function sourcePackage(): Uint8Array {
  const enc = (v: string): Uint8Array => new TextEncoder().encode(v)
  return writeStoredZip([
    { name: '[Content_Types].xml', data: enc(contentTypes) },
    { name: 'ppt/presentation.xml', data: enc(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: enc(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: enc(slide) },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: enc('<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>') },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: enc(layout) },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: enc('<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>') },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: enc(master) },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: enc('<Relationships xmlns="r"/>') },
  ])
}

async function parts(bytes: Uint8Array): Promise<Map<string, string>> {
  const decoder = new TextDecoder()
  return new Map((await readZipEntries(bytes)).map((entry) => [entry.name, decoder.decode(entry.data)]))
}
async function raw(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  return new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
}

describe('master/layout picture background writeback', () => {
  it('materializes media and writes the blipFill on a master background', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const masterId = Object.keys(document.masters ?? {})[0]!
    document.assets = { ...(document.assets ?? {}), asset_new: metadata }
    document.masters![masterId]!.background = { pictureFill: { assetId: 'asset_new', sourceCrop: { left: 5000 } } }

    const output = await exportPptx(document, source, { assetAdapter: adapter })
    const p = await parts(output)
    const r = await raw(output)
    const masterXml = p.get('ppt/slideMasters/slideMaster1.xml')!
    const masterRels = p.get('ppt/slideMasters/_rels/slideMaster1.xml.rels') ?? ''

    expect([...r.keys()].filter((n) => n.startsWith('ppt/media/'))).toHaveLength(1)
    expect(masterRels).toContain('relationships/image')
    expect(masterXml).toContain('<a:blipFill>')
    expect(masterXml).toContain('<a:srcRect l="5000"/>')
    expect((await importPptx(output)).masters?.[masterId]?.background?.pictureFill?.sourceCrop).toEqual({ left: 5000 })
  })

  it('writes a layout picture background too, sharing one media part with the master', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const masterId = Object.keys(document.masters ?? {})[0]!
    const layoutId = Object.keys(document.layouts ?? {})[0]!
    document.assets = { ...(document.assets ?? {}), asset_new: metadata }
    document.masters![masterId]!.background = { pictureFill: { assetId: 'asset_new' } }
    document.layouts![layoutId]!.background = { pictureFill: { assetId: 'asset_new' } }

    const output = await exportPptx(document, source, { assetAdapter: adapter })
    const r = await raw(output)
    const p = await parts(output)

    expect([...r.keys()].filter((n) => n.startsWith('ppt/media/'))).toHaveLength(1)
    expect(p.get('ppt/slideMasters/slideMaster1.xml')).toContain('<a:blipFill>')
    expect(p.get('ppt/slideLayouts/slideLayout1.xml')).toContain('<a:blipFill>')
    expect(p.get('ppt/slideLayouts/slideLayout1.xml')).toContain('xmlns:r=')
  })

  it('stays byte-identical when nothing is edited', async () => {
    const source = sourcePackage()
    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })
})

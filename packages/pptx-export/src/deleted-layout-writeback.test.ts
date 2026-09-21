import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const enc = (v: string): Uint8Array => new TextEncoder().encode(v)
const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>'
const contentTypes = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="a"/><Default Extension="xml" ContentType="b"/>'
  + '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
  + '<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
  + '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
  + '<Override PartName="/ppt/slideLayouts/slideLayout2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
  + '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/></Types>'
const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree/></p:cSld></p:sld>'
const layout = (n: string): string => `<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld name="L${n}"><p:spTree/></p:cSld></p:sldLayout>`
const master = '<p:sldMaster xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree/></p:cSld><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rIdL1"/><p:sldLayoutId id="2147483650" r:id="rIdL2"/></p:sldLayoutIdLst></p:sldMaster>'
const slrels = (n: string): string => `<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout${n}.xml"/></Relationships>`
const lyrels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>'

function sourcePackage(): Uint8Array {
  return writeStoredZip([
    { name: '[Content_Types].xml', data: enc(contentTypes) },
    { name: 'ppt/presentation.xml', data: enc(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: enc(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: enc(slide) },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: enc(slrels('1')) },
    { name: 'ppt/slides/slide2.xml', data: enc(slide) },
    { name: 'ppt/slides/_rels/slide2.xml.rels', data: enc(slrels('2')) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: enc(layout('1')) },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: enc(lyrels) },
    { name: 'ppt/slideLayouts/slideLayout2.xml', data: enc(layout('2')) },
    { name: 'ppt/slideLayouts/_rels/slideLayout2.xml.rels', data: enc(lyrels) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: enc(master) },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: enc('<Relationships xmlns="r"><Relationship Id="rIdL1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rIdL2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout2.xml"/></Relationships>') },
  ])
}

async function partMap(bytes: Uint8Array): Promise<Map<string, string>> {
  const decoder = new TextDecoder()
  return new Map((await readZipEntries(bytes)).map((e) => [e.name, decoder.decode(e.data)]))
}

/**
 * Source writeback cannot distinguish a deleted layout from an unreferenced source layout the importer
 * never surfaced (the importer only imports layouts a slide uses). So a source layout part is preserved
 * rather than removed — a valid deck the reader still opens — while standalone generation, being
 * model-authoritative, is what actually drops it. This pins that safe degradation.
 */
describe('delete layout on source writeback keeps a valid package', () => {
  it('preserves the source layout part and its master listing, and reimports cleanly', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const l1 = document.slides.sld_1!.layoutId!
    document.slides.sld_2!.layoutId = l1
    const l2 = Object.keys(document.layouts ?? {}).find((id) => id !== l1)!
    delete document.layouts![l2]

    const output = await exportPptx(document, source)
    const p = await partMap(output)
    // The part lingers (referenced by the master), so the package stays internally consistent.
    expect(p.has('ppt/slideLayouts/slideLayout2.xml')).toBe(true)
    expect((p.get('ppt/slideMasters/slideMaster1.xml')!.match(/<p:sldLayoutId /gu) ?? []).length).toBe(2)
    const reimported = await importPptx(output)
    expect(reimported.slides.sld_2?.layoutId).toBe(reimported.slides.sld_1?.layoutId)
  })

  it('stays byte-identical when no layout is deleted', async () => {
    const source = sourcePackage()
    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })
})

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
const layout = (n: string): string => `<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld name="Layout${n}"><p:spTree/></p:cSld></p:sldLayout>`
const master = '<p:sldMaster xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree/></p:cSld><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rIdL1"/><p:sldLayoutId id="2147483650" r:id="rIdL2"/></p:sldLayoutIdLst></p:sldMaster>'
const layoutRels = (n: string): string => `<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`
const slideRelsXml = (n: string): string => `<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout${n}.xml"/></Relationships>`

function sourcePackage(): Uint8Array {
  return writeStoredZip([
    { name: '[Content_Types].xml', data: enc(contentTypes) },
    { name: 'ppt/presentation.xml', data: enc(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: enc(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: enc(slide) },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: enc(slideRelsXml('1')) },
    { name: 'ppt/slides/slide2.xml', data: enc(slide) },
    { name: 'ppt/slides/_rels/slide2.xml.rels', data: enc(slideRelsXml('2')) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: enc(layout('1')) },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: enc(layoutRels('1')) },
    { name: 'ppt/slideLayouts/slideLayout2.xml', data: enc(layout('2')) },
    { name: 'ppt/slideLayouts/_rels/slideLayout2.xml.rels', data: enc(layoutRels('2')) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: enc(master) },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: enc('<Relationships xmlns="r"><Relationship Id="rIdL1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rIdL2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout2.xml"/></Relationships>') },
  ])
}

async function slide1Rels(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  return new TextDecoder().decode(entries.get('ppt/slides/_rels/slide1.xml.rels')!)
}

describe('switch a slide layout through writeback', () => {
  it('imports both layouts referenced by the two slides', async () => {
    const document = await importPptx(sourcePackage())
    expect(document.slides.sld_1?.layoutId).toBe('lyt_1')
    expect(document.slides.sld_2?.layoutId).toBe('lyt_2')
  })

  it('repoints slide 1 to layout 2 when its layoutId changes', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    document.slides.sld_1!.layoutId = document.slides.sld_2!.layoutId!

    const rels = await slide1Rels(await exportPptx(document, source))
    expect(rels).toContain('slideLayout2.xml')
    expect(rels).not.toContain('slideLayout1.xml')
  })

  it('stays byte-identical when the layout is untouched', async () => {
    const source = sourcePackage()
    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })
})

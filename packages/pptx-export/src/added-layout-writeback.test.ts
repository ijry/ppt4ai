import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const enc = (v: string): Uint8Array => new TextEncoder().encode(v)
const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const contentTypes = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
  + '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
  + '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/></Types>'
const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree/></p:cSld></p:sld>'
const layout = '<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld name="Base"><p:spTree/></p:cSld></p:sldLayout>'
const master = '<p:sldMaster xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree/></p:cSld><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rIdL1"/></p:sldLayoutIdLst></p:sldMaster>'

function sourcePackage(): Uint8Array {
  return writeStoredZip([
    { name: '[Content_Types].xml', data: enc(contentTypes) },
    { name: 'ppt/presentation.xml', data: enc(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: enc(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: enc(slide) },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: enc('<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>') },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: enc(layout) },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: enc('<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>') },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: enc(master) },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: enc('<Relationships xmlns="r"><Relationship Id="rIdL1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>') },
  ])
}

async function parts(bytes: Uint8Array): Promise<Map<string, string>> {
  const decoder = new TextDecoder()
  return new Map((await readZipEntries(bytes)).map((e) => [e.name, decoder.decode(e.data)]))
}

describe('new layout part materialization on writeback', () => {
  it('writes a new layout part, its rels, master list + content-type, and repoints the switched slide', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const baseLayoutId = document.slides.sld_1!.layoutId!
    const baseLayout = document.layouts![baseLayoutId]!
    // Duplicate the layout in the model with a background, then switch the slide to it.
    document.layouts!.lyt_added = { ...structuredClone(baseLayout), id: 'lyt_added', background: { fill: { color: { type: 'srgb', v: '1F3864' } } } }
    delete (document.layouts!.lyt_added as { source?: unknown }).source
    document.slides.sld_1!.layoutId = 'lyt_added'

    const output = await exportPptx(document, source)
    const p = await parts(output)
    const layoutParts = [...p.keys()].filter((n) => /ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n))
    expect(layoutParts.length).toBe(2)
    // Master lists both layouts, content-types has the new override, the new layout rels point at the master.
    const master = p.get('ppt/slideMasters/slideMaster1.xml')!
    expect((master.match(/<p:sldLayoutId /gu) ?? []).length).toBe(2)
    expect(p.get('[Content_Types].xml')).toContain('slideLayout2.xml')
    expect(p.get('ppt/slideLayouts/_rels/slideLayout2.xml.rels')).toContain('slideMaster1.xml')
    // The slide relationship now points at the new layout part.
    expect(p.get('ppt/slides/_rels/slide1.xml.rels')).toContain('slideLayout2.xml')

    // And it round-trips: reimport sees the slide on a layout carrying the new background.
    const reimported = await importPptx(output)
    const layout = reimported.layouts?.[reimported.slides.sld_1!.layoutId!]
    expect(layout?.background?.fill?.color).toEqual({ type: 'srgb', v: '1F3864' })
  })

  it('stays byte-identical when no layout is added', async () => {
    const source = sourcePackage()
    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })
})

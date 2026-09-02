import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const contentTypes = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/></Types>'

/** The master placeholder carries content we do not model, so a needless rewrite would drop it. */
const masterPlaceholder = '<p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="3" y="20"/><a:ext cx="300" cy="400"/></a:xfrm></p:spPr>'
  + '<p:txBody><a:bodyPr data-body="keep"/><a:lstStyle data-list="keep"><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></a:lstStyle>'
  + '<a:p><a:r><a:t>Master</a:t></a:r></a:p></p:txBody></p:sp>'

function sourcePackage(): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1" y="20"/><a:ext cx="300" cy="400"/></a:xfrm></p:spPr>'
    + '<p:txBody><a:bodyPr/><a:p><a:r><a:t>Slide</a:t></a:r></a:p></p:txBody></p:sp>'
    + '</p:spTree></p:cSld></p:sld>'
  const layout = '<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="2" y="20"/><a:ext cx="300" cy="400"/></a:xfrm></p:spPr>'
    + '<p:txBody><a:bodyPr data-layout-body="keep"/><a:p><a:r><a:t>Layout</a:t></a:r></a:p></p:txBody></p:sp>'
    + '</p:spTree></p:cSld></p:sldLayout>'
  const master = `<p:sldMaster xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>${masterPlaceholder}</p:spTree></p:cSld></p:sldMaster>`
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: new TextEncoder().encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode(presentationRels) },
    { name: '[Content_Types].xml', data: new TextEncoder().encode(contentTypes) },
    { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode(slide) },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: new TextEncoder().encode('<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>') },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: new TextEncoder().encode(layout) },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: new TextEncoder().encode('<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>') },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: new TextEncoder().encode(master) },
  ])
}

async function masterXmlOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  return new TextDecoder().decode(entries.get('ppt/slideMasters/slideMaster1.xml'))
}

describe('master and layout placeholder bodies are only rewritten when they change', () => {
  it('leaves an untouched placeholder txBody byte-identical', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    // Force past the byte-roundtrip short circuit so the range writeback actually runs.
    document.slides.sld_1!.elementIds = [...document.slides.sld_1!.elementIds]
    const element = document.elements.el_1
    if (element?.kind !== 'text') throw new Error('fixture did not import as text')
    element.bounds = { ...element.bounds, x: 99 }

    const masterXml = await masterXmlOf(await exportPptx(document, source))

    expect(masterXml).toContain('<a:bodyPr data-body="keep"/>')
    expect(masterXml).toContain('<a:lstStyle data-list="keep">')
    expect(masterXml).toContain('<a:defRPr sz="4400"/>')
  })

  it('rewrites the placeholder txBody when the default body changes', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const body = document.masters?.mst_1?.defaults?.title?.body
    if (!body) throw new Error('fixture master default body is missing')
    body.paragraphs = [{ runs: [{ text: 'Changed master', marks: { bold: true } }] }]

    const masterXml = await masterXmlOf(await exportPptx(document, source))

    expect(masterXml).toContain('<a:t>Changed master</a:t>')
    expect(masterXml).toContain('b="1"')
  })
})

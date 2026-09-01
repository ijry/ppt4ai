import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="1" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const contentTypes = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>'

/** Group drawn at 2000000x1000000 while its children are authored in a 4000000x2000000 space. */
const scaledSlide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
  + '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="10" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
  + '<p:grpSpPr><a:xfrm><a:off x="1000000" y="2000000"/><a:ext cx="2000000" cy="1000000"/>'
  + '<a:chOff x="5000000" y="6000000"/><a:chExt cx="4000000" cy="2000000"/></a:xfrm></p:grpSpPr>'
  + '<p:sp><p:nvSpPr><p:cNvPr id="11" name="Inner"/><p:nvPr/></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="5000000" y="6000000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>'
  + '<p:txBody><a:bodyPr/><a:p><a:r><a:t>Inner</a:t></a:r></a:p></p:txBody></p:sp>'
  + '</p:grpSp>'
  + '</p:spTree></p:cSld></p:sld>'

function scaledPackage(): Uint8Array {
  return writeStoredZip([
    { name: '[Content_Types].xml', data: new TextEncoder().encode(contentTypes) },
    { name: 'ppt/presentation.xml', data: new TextEncoder().encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode(scaledSlide) },
  ])
}

async function slideXmlOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  return new TextDecoder().decode(entries.get('ppt/slides/slide1.xml'))
}

describe('group bounds writeback', () => {
  it('writes a resized group extent onto grpSpPr', async () => {
    const source = scaledPackage()
    const document = await importPptx(source)
    const group = document.elements.grp_1
    if (group?.kind !== 'group') throw new Error('fixture group was not imported')
    group.bounds = { x: 1000000, y: 2000000, w: 4000000, h: 2000000 }

    const slideXml = await slideXmlOf(await exportPptx(document, source))

    expect(slideXml).toContain('<a:off x="1000000" y="2000000"/><a:ext cx="4000000" cy="2000000"/>')
  })

  it('writes a moved group offset onto grpSpPr', async () => {
    const source = scaledPackage()
    const document = await importPptx(source)
    const group = document.elements.grp_1
    if (group?.kind !== 'group') throw new Error('fixture group was not imported')
    group.bounds = { x: 3000000, y: 4000000, w: 2000000, h: 1000000 }

    const slideXml = await slideXmlOf(await exportPptx(document, source))

    expect(slideXml).toContain('<a:off x="3000000" y="4000000"/><a:ext cx="2000000" cy="1000000"/>')
  })

  it('leaves the child space declaration alone when only the group box moves', async () => {
    const source = scaledPackage()
    const document = await importPptx(source)
    const group = document.elements.grp_1
    if (group?.kind !== 'group') throw new Error('fixture group was not imported')
    group.bounds = { x: 3000000, y: 4000000, w: 2000000, h: 1000000 }

    const slideXml = await slideXmlOf(await exportPptx(document, source))

    expect(slideXml).toContain('<a:chOff x="5000000" y="6000000"/><a:chExt cx="4000000" cy="2000000"/>')
  })

  it('writes an edited child space back onto chOff and chExt', async () => {
    const source = scaledPackage()
    const document = await importPptx(source)
    const group = document.elements.grp_1
    if (group?.kind !== 'group') throw new Error('fixture group was not imported')
    group.childSpace = { x: 5000000, y: 6000000, w: 8000000, h: 4000000 }

    const slideXml = await slideXmlOf(await exportPptx(document, source))

    expect(slideXml).toContain('<a:chOff x="5000000" y="6000000"/><a:chExt cx="8000000" cy="4000000"/>')
  })

  it('does not touch the group when nothing about it changed', async () => {
    const source = scaledPackage()
    const document = await importPptx(source)
    const inner = document.elements.el_1
    if (inner?.kind !== 'text') throw new Error('fixture inner shape was not imported as text')
    inner.body = { paragraphs: [{ runs: [{ text: 'Edited' }] }] }

    const slideXml = await slideXmlOf(await exportPptx(document, source))

    expect(slideXml).toContain('<a:off x="1000000" y="2000000"/><a:ext cx="2000000" cy="1000000"/>')
    expect(slideXml).toContain('<a:chOff x="5000000" y="6000000"/><a:chExt cx="4000000" cy="2000000"/>')
  })

  it('writes the child extent that keeps a resized group visually stable', async () => {
    const source = scaledPackage()
    const document = await importPptx(source)
    const group = document.elements.grp_1
    if (group?.kind !== 'group') throw new Error('fixture group was not imported')
    // Doubling the drawn width while doubling the child extent keeps the scale factor at 1:2.
    group.bounds = { x: 1000000, y: 2000000, w: 4000000, h: 2000000 }
    group.childSpace = { x: 5000000, y: 6000000, w: 8000000, h: 4000000 }

    const slideXml = await slideXmlOf(await exportPptx(document, source))

    expect(slideXml).toContain('<a:off x="1000000" y="2000000"/><a:ext cx="4000000" cy="2000000"/>')
    expect(slideXml).toContain('<a:chOff x="5000000" y="6000000"/><a:chExt cx="8000000" cy="4000000"/>')
    expect(slideXml).toContain('<a:off x="5000000" y="6000000"/><a:ext cx="4000000" cy="2000000"/>')
  })
})

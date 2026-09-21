import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="1" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const contentTypes = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>'

/** The group is scaled 2:1, so the child's authored coordinates are twice its on-slide size. */
const scaledSlide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
  + '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="10" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
  + '<p:grpSpPr><a:xfrm><a:off x="1000000" y="2000000"/><a:ext cx="2000000" cy="1000000"/>'
  + '<a:chOff x="5000000" y="6000000"/><a:chExt cx="4000000" cy="2000000"/></a:xfrm></p:grpSpPr>'
  + '<p:sp><p:nvSpPr><p:cNvPr id="11" name="Inner"/><p:nvPr/></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="5000000" y="6000000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>'
  + '<p:txBody><a:bodyPr/><a:p><a:r><a:t>Inner</a:t></a:r></a:p></p:txBody></p:sp>'
  + '</p:grpSp>'
  + '<p:sp><p:nvSpPr><p:cNvPr id="12" name="Outside"/><p:nvPr/></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="6000000" y="1000000"/><a:ext cx="1000000" cy="500000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>'
  + '<p:txBody><a:bodyPr/><a:p><a:r><a:t>Outside</a:t></a:r></a:p></p:txBody></p:sp>'
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

describe('scaled group child coordinate writeback', () => {
  it('keeps a untouched child in its authored child space when a sibling is edited', async () => {
    const source = scaledPackage()
    const document = await importPptx(source)
    const outside = document.elements.el_2
    if (outside?.kind !== 'text') throw new Error('fixture sibling was not imported as text')
    outside.body = { paragraphs: [{ runs: [{ text: 'Edited outside' }] }] }

    const slideXml = await slideXmlOf(await exportPptx(document, source))

    expect(slideXml).toContain('Edited outside')
    expect(slideXml).toContain('<a:off x="5000000" y="6000000"/><a:ext cx="4000000" cy="2000000"/>')
  })

  it('keeps the child space declaration intact', async () => {
    const source = scaledPackage()
    const document = await importPptx(source)
    const outside = document.elements.el_2!
    outside.bounds = { x: 6500000, y: 1000000, w: 1000000, h: 500000 }

    const slideXml = await slideXmlOf(await exportPptx(document, source))

    expect(slideXml).toContain('<a:chOff x="5000000" y="6000000"/><a:chExt cx="4000000" cy="2000000"/>')
  })
})

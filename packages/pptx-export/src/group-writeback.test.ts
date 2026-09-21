import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="1" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const contentTypes = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>'

const groupedSlide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
  + '<p:grpSp data-preserve="group"><p:nvGrpSpPr><p:cNvPr id="10" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
  + '<p:grpSpPr><a:xfrm rot="900000"><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:grpSpPr>'
  + '<p:sp data-preserve="inner"><p:nvSpPr><p:cNvPr id="11" name="Inner"/><p:nvPr/></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="1200000" y="1200000"/><a:ext cx="1000000" cy="500000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>'
  + '<p:txBody><a:bodyPr/><a:p><a:r><a:t>Inner</a:t></a:r></a:p></p:txBody></p:sp>'
  + '</p:grpSp>'
  + '<p:sp data-preserve="outside"><p:nvSpPr><p:cNvPr id="12" name="Outside"/><p:nvPr/></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="6000000" y="1000000"/><a:ext cx="1000000" cy="500000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>'
  + '<p:txBody><a:bodyPr/><a:p><a:r><a:t>Outside</a:t></a:r></a:p></p:txBody></p:sp>'
  + '</p:spTree></p:cSld></p:sld>'

function groupedPackage(): Uint8Array {
  return writeStoredZip([
    { name: '[Content_Types].xml', data: new TextEncoder().encode(contentTypes) },
    { name: 'ppt/presentation.xml', data: new TextEncoder().encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode(groupedSlide) },
  ])
}

async function slideXmlOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  return new TextDecoder().decode(entries.get('ppt/slides/slide1.xml'))
}

describe('group source package writeback', () => {
  it('round-trips an unedited grouped slide byte for byte', async () => {
    const source = groupedPackage()
    const document = await importPptx(source)

    expect(await exportPptx(document, source)).toEqual(source)
  })

  it('writes back an edit to a shape nested inside a group', async () => {
    const source = groupedPackage()
    const document = await importPptx(source)
    const inner = document.elements.el_1
    if (inner?.kind !== 'text') throw new Error('fixture inner shape was not imported as text')
    inner.body = { paragraphs: [{ runs: [{ text: 'Edited inner' }] }] }

    const slideXml = await slideXmlOf(await exportPptx(document, source))

    expect(slideXml).toContain('Edited inner')
    expect(slideXml).toContain('data-preserve="group"')
    expect(slideXml).toContain('<p:grpSpPr><a:xfrm rot="900000">')
    expect(slideXml).toContain('Outside')
  })

  it('writes back an edit to the sibling outside the group without disturbing group contents', async () => {
    const source = groupedPackage()
    const document = await importPptx(source)
    const outside = document.elements.el_2
    if (outside?.kind !== 'text') throw new Error('fixture outside shape was not imported as text')
    outside.body = { paragraphs: [{ runs: [{ text: 'Edited outside' }] }] }

    const slideXml = await slideXmlOf(await exportPptx(document, source))

    expect(slideXml).toContain('Edited outside')
    expect(slideXml).toContain('<a:t>Inner</a:t>')
  })

  it('writes back bounds for a shape nested inside a group', async () => {
    const source = groupedPackage()
    const document = await importPptx(source)
    const inner = document.elements.el_1!
    inner.bounds = { x: 1500000, y: 1600000, w: 1100000, h: 600000 }

    const slideXml = await slideXmlOf(await exportPptx(document, source))

    expect(slideXml).toContain('<a:off x="1500000" y="1600000"/>')
    expect(slideXml).toContain('<a:ext cx="1100000" cy="600000"/>')
  })

  it('writes the group rotation back onto grpSpPr, not onto a child', async () => {
    const source = groupedPackage()
    const document = await importPptx(source)
    const group = document.elements.grp_1
    if (group?.kind !== 'group') throw new Error('fixture group was not imported')
    group.rotation = 2700000

    const slideXml = await slideXmlOf(await exportPptx(document, source))

    expect(slideXml).toContain('<p:grpSpPr><a:xfrm rot="2700000">')
    expect(slideXml).toContain('<a:off x="1200000" y="1200000"/>')
  })

  it('removes the group rotation attribute when the rotation is cleared', async () => {
    const source = groupedPackage()
    const document = await importPptx(source)
    const group = document.elements.grp_1
    if (group?.kind !== 'group') throw new Error('fixture group was not imported')
    delete group.rotation

    const slideXml = await slideXmlOf(await exportPptx(document, source))

    expect(slideXml).toContain('<p:grpSpPr><a:xfrm>')
    expect(slideXml).not.toContain('rot="900000"')
  })

  it('rejects export when a non-group element occupies the group slot', async () => {
    const source = groupedPackage()
    const document = await importPptx(source)
    const slide = document.slides[document.slideOrder[0]!]!
    document.elements.grp_1 = { id: 'grp_1', kind: 'shape', bounds: { x: 0, y: 0, w: 100, h: 100 }, preset: 'rect' }
    slide.elementIds = [...slide.elementIds]

    await expect(exportPptx(document, source)).rejects.toThrow(/prefix mismatch/)
  })

  it('writes a group flip onto grpSpPr alongside the rotation', async () => {
    const source = groupedPackage()
    const document = await importPptx(source)
    const group = document.elements.grp_1
    if (group?.kind !== 'group') throw new Error('fixture group was not imported')
    group.flipH = true

    const slideXml = await slideXmlOf(await exportPptx(document, source))

    expect(slideXml).toContain('<p:grpSpPr><a:xfrm flipH="1" rot="900000">')
    expect((await importPptx(await exportPptx(document, source))).elements.grp_1).toMatchObject({ flipH: true, rotation: 900000 })
  })

  it('removes a group flip when the model clears it', async () => {
    const flippedSource = writeStoredZip([
      { name: '[Content_Types].xml', data: new TextEncoder().encode(contentTypes) },
      { name: 'ppt/presentation.xml', data: new TextEncoder().encode(presentation) },
      { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode(presentationRels) },
      { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode(groupedSlide.replace('<a:xfrm rot="900000">', '<a:xfrm rot="900000" flipV="1">')) },
    ])
    const document = await importPptx(flippedSource)
    const group = document.elements.grp_1
    if (group?.kind !== 'group') throw new Error('fixture group was not imported')
    expect(group).toMatchObject({ flipV: true })
    delete group.flipV

    const slideXml = await slideXmlOf(await exportPptx(document, flippedSource))

    expect(slideXml).toContain('<p:grpSpPr><a:xfrm rot="900000">')
    expect(slideXml).not.toContain('flipV')
  })
})

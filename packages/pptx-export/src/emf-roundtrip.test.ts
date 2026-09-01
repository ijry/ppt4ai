import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const emfBytes = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x6c, 0x00, 0x00, 0x00, 0x20, 0x45, 0x4d, 0x46])

function packageWithEmfPicture(): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>'
    + '<p:pic><p:nvPicPr><p:cNvPr id="2" name="Vector"/></p:nvPicPr>'
    + '<p:blipFill><a:blip r:embed="rId2"/></p:blipFill>'
    + '<p:spPr><a:xfrm><a:off x="100000" y="200000"/><a:ext cx="3000000" cy="1500000"/></a:xfrm></p:spPr></p:pic>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Box"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="400000" y="500000"/><a:ext cx="1000000" cy="800000"/></a:xfrm></p:spPr>'
    + '<p:txBody><a:p><a:r><a:t>After</a:t></a:r></a:p></p:txBody></p:sp>'
    + '</p:spTree></p:cSld></p:sld>'
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: new TextEncoder().encode('<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>') },
    { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode('<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>') },
    { name: '[Content_Types].xml', data: new TextEncoder().encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="emf" ContentType="image/x-emf"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>') },
    { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode(slide) },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: new TextEncoder().encode('<Relationships xmlns="r"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.emf"/></Relationships>') },
    { name: 'ppt/media/image1.emf', data: emfBytes },
  ])
}

describe('EMF source package round-trip', () => {
  it('returns exact source bytes for an unedited document, so the EMF survives', async () => {
    const source = packageWithEmfPicture()
    const document = await importPptx(source)

    const exported = await exportPptx(document, source)

    expect(exported).toEqual(source)
  })

  it('rejects export when a model element occupies the skipped picture id', async () => {
    const source = packageWithEmfPicture()
    const document = await importPptx(source)
    const slide = document.slides[document.slideOrder[0]!]!
    document.elements.el_1 = { id: 'el_1', kind: 'shape', bounds: { x: 0, y: 0, w: 100, h: 100 }, preset: 'rect' }
    slide.elementIds = ['el_1', ...slide.elementIds]

    await expect(exportPptx(document, source)).rejects.toThrow()
  })

  it('preserves the unmodelled EMF picture and its media bytes when other elements are edited', async () => {
    const source = packageWithEmfPicture()
    const document = await importPptx(source)
    const textId = document.slides[document.slideOrder[0]!]!.elementIds[0]!
    const text = document.elements[textId]!
    if (text.kind !== 'text') throw new Error('fixture text element was not imported')
    text.body = { paragraphs: [{ runs: [{ text: 'Edited' }] }] }

    const exported = await exportPptx(document, source)
    const entries = new Map((await readZipEntries(exported)).map((entry) => [entry.name, entry.data]))
    const slideXml = new TextDecoder().decode(entries.get('ppt/slides/slide1.xml'))

    expect(entries.get('ppt/media/image1.emf')).toEqual(emfBytes)
    expect(slideXml).toContain('<p:pic>')
    expect(slideXml).toContain('r:embed="rId2"')
    expect(slideXml).toContain('Edited')
  })
})

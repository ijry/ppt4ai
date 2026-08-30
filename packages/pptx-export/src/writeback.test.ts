import { importPptx } from '@ppt4ai/pptx-import'
import type { AssetAdapter, AssetMetadata, ImageElement } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="1" r:id="rId1"/></p:sldIdLst></p:presentation>'
const relationships = '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const contentTypes = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>'
const tableXml = '<a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="1000000"/></a:tblGrid><a:tr h="1000000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Before</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl>'
const neighborXml = '<p:sp data-preserve="yes"><p:nvSpPr><p:cNvPr id="2" name="Neighbor"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></a:xfrm></p:spPr></p:sp>'
const slide = `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="1" name="Table"/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">${tableXml}</a:graphicData></a:graphic></p:graphicFrame>${neighborXml}</p:spTree></p:cSld></p:sld>`

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x10,
  0x08, 0x06, 0x00, 0x00, 0x00,
])
const secondPngBytes = new Uint8Array([...pngBytes, 0x01])
const jpegBytes = new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x18, 0x00, 0x28,
  0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
])

function pictureXml(relationshipId: string, shapeId: number, x = 10): string {
  return `<p:pic data-preserve="yes"><p:nvPicPr><p:cNvPr id="${shapeId}" name="Picture ${shapeId}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relationshipId}"><a:grayscl/></a:blip><a:srcRect l="1000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm rot="60000"><a:off x="${x}" y="20"/><a:ext cx="300" cy="400"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
}

function imageSourcePackage(twoPictures = false): Uint8Array {
  const pictures = `${pictureXml('rId2', 5)}${twoPictures ? pictureXml('rId3', 6, 500) : ''}`
  const slideRelationships = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>${twoPictures ? '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.png"/>' : ''}</Relationships>`
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: new TextEncoder().encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode(relationships) },
    { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode(`<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>${pictures}</p:spTree></p:cSld></p:sld>`) },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: new TextEncoder().encode(slideRelationships) },
    { name: 'ppt/media/image1.png', data: pngBytes },
    ...(twoPictures ? [{ name: 'ppt/media/image2.png', data: secondPngBytes }] : []),
  ])
}

class RecordingAssetAdapter implements AssetAdapter {
  readonly requests: string[] = []

  constructor(readonly assets: Map<string, Uint8Array>) {}

  async get(assetId: string): Promise<Uint8Array | undefined> {
    this.requests.push(assetId)
    const bytes = this.assets.get(assetId)
    return bytes ? new Uint8Array(bytes) : undefined
  }

  async put(_assetId: string, _data: Uint8Array, _metadata: AssetMetadata): Promise<void> {}
}

async function packageEntries(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  return new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
}

function replaceImportedImage(document: Awaited<ReturnType<typeof importPptx>>, assetId = 'asset_new'): ImageElement {
  const image = document.elements.el_1
  if (!image || image.kind !== 'image') throw new Error('fixture image was not imported')
  image.assetId = assetId
  document.assets ??= {}
  document.assets[assetId] = { id: assetId, mimeType: 'image/jpeg', pixelWidth: 40, pixelHeight: 24 }
  return image
}

function sourcePackage(): Uint8Array {
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: new TextEncoder().encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode(relationships) },
    { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode(slide) },
    { name: 'ppt/media/image1.bin', data: new Uint8Array([0, 17, 255, 3]) },
  ])
}

function structuralSourcePackage(): Uint8Array {
  const firstSlide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="First"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>First slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
  const secondSlide = firstSlide.replaceAll('First', 'Second').replaceAll('id="1"', 'id="2"')
  const slideRelationships = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>'
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: new TextEncoder().encode('<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>') },
    { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>') },
    { name: '[Content_Types].xml', data: new TextEncoder().encode(contentTypes) },
    { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode(firstSlide) },
    { name: 'ppt/slides/slide2.xml', data: new TextEncoder().encode(secondSlide) },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: new TextEncoder().encode(slideRelationships) },
    { name: 'ppt/slides/_rels/slide2.xml.rels', data: new TextEncoder().encode(slideRelationships) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: new TextEncoder().encode('<p:sldLayout xmlns:p="p"/>') },
    { name: 'ppt/theme/theme1.xml', data: new TextEncoder().encode('<a:theme xmlns:a="a" data-keep="yes"/>') },
    { name: 'custom/unknown.bin', data: new Uint8Array([7, 3, 1, 4]) },
  ])
}

function dependentSourcePackage(): Uint8Array {
  const relationshipNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships'
  const officeRelationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const contentTypeNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types'
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: new TextEncoder().encode('<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>') },
    { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode(`<Relationships xmlns="${relationshipNamespace}"><Relationship Id="rId1" Type="${officeRelationshipNamespace}/slide" Target="slides/slide1.xml"/></Relationships>`) },
    { name: '[Content_Types].xml', data: new TextEncoder().encode(`<Types xmlns="${contentTypeNamespace}"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/><Override PartName="/ppt/custom/data1.xml" ContentType="application/xml"/></Types>`) },
    { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode('<p:sld xmlns:p="p"><p:cSld><p:spTree/></p:cSld></p:sld>') },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: new TextEncoder().encode(`<Relationships xmlns="${relationshipNamespace}"><Relationship Id="rId1" Type="${officeRelationshipNamespace}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${officeRelationshipNamespace}/notesSlide" Target="../notesSlides/notesSlide1.xml"/><Relationship Id="rId3" Type="${officeRelationshipNamespace}/image" Target="../media/image1.png"/></Relationships>`) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: new TextEncoder().encode('<p:sldLayout xmlns:p="p"/>') },
    { name: 'ppt/notesSlides/notesSlide1.xml', data: new TextEncoder().encode('<p:notes xmlns:p="p">original notes</p:notes>') },
    { name: 'ppt/notesSlides/_rels/notesSlide1.xml.rels', data: new TextEncoder().encode(`<Relationships xmlns="${relationshipNamespace}"><Relationship Id="rId1" Type="${officeRelationshipNamespace}/customXml" Target="../custom/data1.xml"/></Relationships>`) },
    { name: 'ppt/custom/data1.xml', data: new TextEncoder().encode('<custom:data xmlns:custom="custom">original dependency</custom:data>') },
    { name: 'ppt/media/image1.png', data: pngBytes },
  ])
}

describe('exportPptx', () => {
  it('writes reordered source slides in document order', async () => {
    const source = structuralSourcePackage()
    const document = await importPptx(source)
    document.slideOrder.reverse()

    const output = await exportPptx(document, source)
    const entries = await packageEntries(output)
    const presentationXml = new TextDecoder().decode(entries.get('ppt/presentation.xml'))
    const imported = await importPptx(output)

    expect(presentationXml.indexOf('id="257"')).toBeLessThan(presentationXml.indexOf('id="256"'))
    expect(imported.elements[imported.slides.sld_1?.elementIds[0] ?? '']).toMatchObject({ text: 'Second slide' })
    expect(imported.elements[imported.slides.sld_2?.elementIds[0] ?? '']).toMatchObject({ text: 'First slide' })
    expect(entries.get('custom/unknown.bin')).toEqual(new Uint8Array([7, 3, 1, 4]))
  })

  it('removes deleted source slide parts and references while retaining shared entries', async () => {
    const source = structuralSourcePackage()
    const document = await importPptx(source)
    delete document.slides.sld_1
    document.slideOrder = ['sld_2']

    const output = await exportPptx(document, source)
    const entries = await packageEntries(output)
    const presentationXml = new TextDecoder().decode(entries.get('ppt/presentation.xml'))
    const presentationRelationships = new TextDecoder().decode(entries.get('ppt/_rels/presentation.xml.rels'))
    const outputContentTypes = new TextDecoder().decode(entries.get('[Content_Types].xml'))

    expect(presentationXml).not.toContain('id="256"')
    expect(presentationXml).toContain('id="257"')
    expect(presentationRelationships).not.toContain('Target="slides/slide1.xml"')
    expect(entries.get('ppt/slides/slide1.xml')).toBeUndefined()
    expect(entries.get('ppt/slides/_rels/slide1.xml.rels')).toBeUndefined()
    expect(outputContentTypes).not.toContain('/ppt/slides/slide1.xml')
    expect(entries.get('ppt/slides/slide2.xml')).toBeDefined()
    expect(entries.get('ppt/slideLayouts/slideLayout1.xml')).toBeDefined()
    expect(entries.get('custom/unknown.bin')).toEqual(new Uint8Array([7, 3, 1, 4]))
  })

  it('writes a blank slide with a deterministic layout relationship', async () => {
    const source = structuralSourcePackage()
    const document = await importPptx(source)
    const blankSlideId = 'sld_blank'
    document.slides[blankSlideId] = {
      id: blankSlideId,
      elementIds: [],
      ...(document.slides.sld_1?.layoutId ? { layoutId: document.slides.sld_1.layoutId } : {}),
    }
    document.slideOrder = ['sld_1', blankSlideId, 'sld_2']
    const expectedDocument = structuredClone(document)

    const output = await exportPptx(document, source)
    const entries = await packageEntries(output)
    const presentationXml = new TextDecoder().decode(entries.get('ppt/presentation.xml'))
    const presentationRelationships = new TextDecoder().decode(entries.get('ppt/_rels/presentation.xml.rels'))
    const blankRelationships = new TextDecoder().decode(entries.get('ppt/slides/_rels/slide3.xml.rels'))
    const outputContentTypes = new TextDecoder().decode(entries.get('[Content_Types].xml'))
    const imported = await importPptx(output)

    expect(entries.get('ppt/slides/slide3.xml')).toBeDefined()
    expect(new TextDecoder().decode(entries.get('ppt/slides/slide3.xml'))).toContain('<p:spTree>')
    expect(presentationXml).toContain('<p:sldId id="258" r:id="rId3"/>')
    expect(presentationRelationships).toContain('Id="rId3"')
    expect(presentationRelationships).toContain('Target="slides/slide3.xml"')
    expect(blankRelationships).toContain('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"')
    expect(blankRelationships).toContain('Target="../slideLayouts/slideLayout1.xml"')
    expect(outputContentTypes).toContain('PartName="/ppt/slides/slide3.xml"')
    expect(imported.slideOrder).toHaveLength(3)
    expect(imported.slides.sld_2?.elementIds).toEqual([])
    expect(entries.get('custom/unknown.bin')).toEqual(new Uint8Array([7, 3, 1, 4]))
    expect(document).toEqual(expectedDocument)
  })

  it('clones a source slide into a fresh part while retaining its source XML', async () => {
    const source = structuralSourcePackage()
    const document = await importPptx(source)
    const copiedSlide = structuredClone(document.slides.sld_1!)
    copiedSlide.id = 'sld_copy'
    document.slides.sld_copy = copiedSlide
    document.slideOrder = ['sld_1', 'sld_copy', 'sld_2']
    const expectedDocument = structuredClone(document)
    const sourceEntries = await packageEntries(source)

    const first = await exportPptx(document, source)
    const second = await exportPptx(document, source)
    const entries = await packageEntries(first)
    const imported = await importPptx(first)

    expect(first).toEqual(second)
    expect(entries.get('ppt/slides/slide3.xml')).toEqual(sourceEntries.get('ppt/slides/slide1.xml'))
    expect(entries.get('ppt/slides/_rels/slide3.xml.rels')).toEqual(sourceEntries.get('ppt/slides/_rels/slide1.xml.rels'))
    expect(new TextDecoder().decode(entries.get('ppt/_rels/presentation.xml.rels'))).toContain('Target="slides/slide3.xml"')
    expect(imported.slideOrder).toHaveLength(3)
    expect(imported.elements[imported.slides.sld_2?.elementIds[0] ?? '']).toMatchObject({ text: 'First slide' })
    expect(document).toEqual(expectedDocument)
  })

  it('clones slide-owned dependencies while keeping shared layout parts', async () => {
    const source = dependentSourcePackage()
    const document = await importPptx(source)
    const copiedSlide = structuredClone(document.slides.sld_1!)
    copiedSlide.id = 'sld_copy'
    document.slides.sld_copy = copiedSlide
    document.slideOrder = ['sld_1', 'sld_copy']
    const sourceEntries = await packageEntries(source)

    const output = await exportPptx(document, source)
    const entries = await packageEntries(output)
    const clonedRelationships = new TextDecoder().decode(entries.get('ppt/slides/_rels/slide2.xml.rels'))

    expect(clonedRelationships).toContain('Target="../slideLayouts/slideLayout1.xml"')
    expect(clonedRelationships).toContain('Target="../notesSlides/notesSlide2.xml"')
    expect(clonedRelationships).toContain('Target="../media/image2.png"')
    expect(entries.get('ppt/notesSlides/notesSlide2.xml')).toEqual(sourceEntries.get('ppt/notesSlides/notesSlide1.xml'))
    expect(entries.get('ppt/notesSlides/_rels/notesSlide2.xml.rels')).toBeDefined()
    expect(entries.get('ppt/custom/data2.xml')).toEqual(sourceEntries.get('ppt/custom/data1.xml'))
    expect(entries.get('ppt/media/image2.png')).toEqual(sourceEntries.get('ppt/media/image1.png'))
    expect(new TextDecoder().decode(entries.get('[Content_Types].xml'))).toContain('PartName="/ppt/notesSlides/notesSlide2.xml"')
    expect(new TextDecoder().decode(entries.get('[Content_Types].xml'))).toContain('PartName="/ppt/custom/data2.xml"')
  })

  it('replaces imported table XML while preserving the package', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const table = document.elements.el_1
    if (!table || table.kind !== 'table') throw new Error('fixture table was not imported')
    table.rows[0]!.cells[0]!.body.paragraphs[0]!.runs[0]!.text = 'After & exported'
    const expectedDocument = structuredClone(document)

    const first = await exportPptx(document, source)
    const second = await exportPptx(document, source)

    expect(first).toEqual(second)
    const entries = await readZipEntries(first)
    expect(entries.map((entry) => entry.name)).toEqual([
      'ppt/presentation.xml',
      'ppt/_rels/presentation.xml.rels',
      'ppt/slides/slide1.xml',
      'ppt/media/image1.bin',
    ])
    const outputSlide = new TextDecoder().decode(entries[2]!.data)
    expect(outputSlide).toContain('<a:t>After &amp; exported</a:t>')
    expect(outputSlide).not.toContain('<a:t>Before</a:t>')
    expect(outputSlide).toContain(neighborXml)
    expect(entries[3]!.data).toEqual(new Uint8Array([0, 17, 255, 3]))
    expect(document).toEqual(expectedDocument)
  })

  it('rejects a slide element count mismatch', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    document.slides.sld_1!.elementIds.pop()

    await expect(exportPptx(document, source)).rejects.toThrow('PPTX export element count mismatch for slide sld_1')
  })

  it('preserves an unchanged imported image without reading the adapter', async () => {
    const source = imageSourcePackage()
    const document = await importPptx(source)
    const adapter = new RecordingAssetAdapter(new Map())

    const output = await exportPptx(document, source, { assetAdapter: adapter })

    expect(output).toEqual(source)
    expect(adapter.requests).toEqual([])
  })

  it('writes a replacement asset and changes only the existing picture embed', async () => {
    const source = imageSourcePackage()
    const document = await importPptx(source)
    replaceImportedImage(document)
    const expectedDocument = structuredClone(document)
    const expectedSource = new Uint8Array(source)
    const adapter = new RecordingAssetAdapter(new Map([['asset_new', jpegBytes]]))

    const first = await exportPptx(document, source, { assetAdapter: adapter })
    const secondAdapter = new RecordingAssetAdapter(new Map([['asset_new', jpegBytes]]))
    const second = await exportPptx(document, source, { assetAdapter: secondAdapter })
    const entries = await packageEntries(first)
    const outputSlide = new TextDecoder().decode(entries.get('ppt/slides/slide1.xml'))
    const outputRelationships = new TextDecoder().decode(entries.get('ppt/slides/_rels/slide1.xml.rels'))

    expect(first).toEqual(second)
    expect(adapter.requests).toEqual(['asset_new'])
    expect(entries.get('ppt/media/image2.jpg')).toEqual(jpegBytes)
    expect(outputSlide).toContain(pictureXml('rId3', 5))
    expect(outputRelationships).toContain('Id="rId3"')
    expect(outputRelationships).toContain('Target="../media/image2.jpg"')
    expect(document).toEqual(expectedDocument)
    expect(source).toEqual(expectedSource)
  })

  it('appends trailing images and reuses one new media asset', async () => {
    const source = imageSourcePackage()
    const document = await importPptx(source)
    const sourceImage = document.elements.el_1
    if (!sourceImage || sourceImage.kind !== 'image') throw new Error('fixture image was not imported')
    document.assets ??= {}
    document.assets.asset_new = { id: 'asset_new', mimeType: 'image/png', pixelWidth: 32, pixelHeight: 16 }
    document.elements.img_new_1 = { ...structuredClone(sourceImage), id: 'img_new_1', assetId: 'asset_new', bounds: { x: 500, y: 20, w: 300, h: 400 } }
    document.elements.img_new_2 = { ...structuredClone(sourceImage), id: 'img_new_2', assetId: 'asset_new', bounds: { x: 900, y: 20, w: 300, h: 400 } }
    document.slides.sld_1!.elementIds.push('img_new_1', 'img_new_2')
    const adapter = new RecordingAssetAdapter(new Map([['asset_new', secondPngBytes]]))

    const output = await exportPptx(document, source, { assetAdapter: adapter })
    const entries = await packageEntries(output)
    const outputSlide = new TextDecoder().decode(entries.get('ppt/slides/slide1.xml'))
    const outputRelationships = new TextDecoder().decode(entries.get('ppt/slides/_rels/slide1.xml.rels'))

    expect(adapter.requests).toEqual(['asset_new'])
    expect(entries.get('ppt/media/image2.png')).toEqual(secondPngBytes)
    expect((outputSlide.match(/<p:pic\b/g) ?? [])).toHaveLength(3)
    expect(outputSlide.indexOf('name="img_new_1"')).toBeLessThan(outputSlide.indexOf('name="img_new_2"'))
    expect((outputRelationships.match(/Target="\.\.\/media\/image2\.png"/g) ?? [])).toHaveLength(2)
  })

  it('creates a missing slide relationship part for a trailing image', async () => {
    const source = writeStoredZip([
      { name: 'ppt/presentation.xml', data: new TextEncoder().encode(presentation) },
      { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode(relationships) },
      { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode('<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree/></p:cSld></p:sld>') },
    ])
    const document = await importPptx(source)
    document.assets = { asset_new: { id: 'asset_new', mimeType: 'image/png', pixelWidth: 32, pixelHeight: 16 } }
    document.elements.img_new = {
      id: 'img_new',
      kind: 'image',
      bounds: { x: 10, y: 20, w: 300, h: 400 },
      assetId: 'asset_new',
    }
    document.slides.sld_1!.elementIds.push('img_new')
    const adapter = new RecordingAssetAdapter(new Map([['asset_new', pngBytes]]))

    const output = await exportPptx(document, source, { assetAdapter: adapter })
    const entries = await packageEntries(output)
    const outputRelationships = new TextDecoder().decode(entries.get('ppt/slides/_rels/slide1.xml.rels'))

    expect(outputRelationships).toContain('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">')
    expect(outputRelationships).toContain('Target="../media/image1.png"')
  })

  it('rejects replacement assets without an adapter or bytes', async () => {
    const source = imageSourcePackage()
    const document = await importPptx(source)
    replaceImportedImage(document)

    await expect(exportPptx(document, source)).rejects.toThrow('PPTX export asset adapter missing: asset_new')
    const adapter = new RecordingAssetAdapter(new Map())
    await expect(exportPptx(document, source, { assetAdapter: adapter })).rejects.toThrow('PPTX export asset bytes missing: asset_new')
    expect(adapter.requests).toEqual(['asset_new'])
  })

  it('rejects adapter bytes whose MIME does not match document metadata', async () => {
    const source = imageSourcePackage()
    const document = await importPptx(source)
    replaceImportedImage(document)
    const adapter = new RecordingAssetAdapter(new Map([['asset_new', pngBytes]]))

    await expect(exportPptx(document, source, { assetAdapter: adapter })).rejects.toThrow('PPTX export asset bytes MIME mismatch: asset_new')
  })

  it('rejects reordered source elements and non-image trailing additions', async () => {
    const reorderedSource = imageSourcePackage(true)
    const reordered = await importPptx(reorderedSource)
    reordered.slides.sld_1!.elementIds.reverse()
    await expect(exportPptx(reordered, reorderedSource)).rejects.toThrow('PPTX export element prefix mismatch for slide sld_1')

    const source = imageSourcePackage()
    const document = await importPptx(source)
    document.elements.shape_new = { id: 'shape_new', kind: 'shape', bounds: { x: 1, y: 1, w: 1, h: 1 }, preset: 'rect' }
    document.slides.sld_1!.elementIds.push('shape_new')
    await expect(exportPptx(document, source)).rejects.toThrow('PPTX export only supports trailing image additions for slide sld_1')
  })

  it('rejects replacing an existing non-image source element with an image', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    document.elements.el_2 = {
      id: 'el_2',
      kind: 'image',
      bounds: { x: 1, y: 1, w: 1, h: 1 },
      assetId: 'asset_new',
    }
    document.assets = { asset_new: { id: 'asset_new', mimeType: 'image/png', pixelWidth: 32, pixelHeight: 16 } }

    await expect(exportPptx(document, source, { assetAdapter: new RecordingAssetAdapter(new Map([['asset_new', pngBytes]])) }))
      .rejects.toThrow('PPTX export element prefix mismatch for slide sld_1')
  })

  it('skips an unimportable picture while preserving later importer element IDs', async () => {
    const source = writeStoredZip([
      { name: 'ppt/presentation.xml', data: new TextEncoder().encode(presentation) },
      { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode(relationships) },
      { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode(`<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree><p:pic><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic>${neighborXml}</p:spTree></p:cSld></p:sld>`) },
      { name: 'ppt/slides/_rels/slide1.xml.rels', data: new TextEncoder().encode('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>') },
      { name: 'ppt/media/image1.png', data: pngBytes },
    ])
    const document = await importPptx(source)

    expect(document.slides.sld_1?.elementIds).toEqual(['el_2'])
    await expect(exportPptx(document, source)).resolves.toEqual(source)
  })

  it('rejects an unresolved source picture relationship', async () => {
    const validSource = imageSourcePackage()
    const document = await importPptx(validSource)
    const entries = await readZipEntries(validSource)
    const relationshipEntry = entries.find((entry) => entry.name === 'ppt/slides/_rels/slide1.xml.rels')
    if (!relationshipEntry) throw new Error('fixture relationships missing')
    relationshipEntry.data = new TextEncoder().encode(new TextDecoder().decode(relationshipEntry.data).replace('relationships/image', 'relationships/unsupported'))
    const malformedSource = writeStoredZip(entries)

    await expect(exportPptx(document, malformedSource)).rejects.toThrow('PPTX export image relationship missing for slide sld_1')
  })
})

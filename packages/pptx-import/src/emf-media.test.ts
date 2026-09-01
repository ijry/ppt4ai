import { describe, expect, it } from 'vitest'
import { importPptx } from './index'

function storedEntry(name: string, data: Uint8Array): { name: string; data: Uint8Array } {
  return { name, data }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeStoredZip(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name)
    const local = new Uint8Array(30 + name.length + entry.data.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(8, 0, true)
    localView.setUint32(14, crc32(entry.data), true)
    localView.setUint32(18, entry.data.length, true)
    localView.setUint32(22, entry.data.length, true)
    localView.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(entry.data, 30 + name.length)
    chunks.push(local)

    const header = new Uint8Array(46 + name.length)
    const headerView = new DataView(header.buffer)
    headerView.setUint32(0, 0x02014b50, true)
    headerView.setUint16(4, 20, true)
    headerView.setUint16(6, 20, true)
    headerView.setUint32(16, crc32(entry.data), true)
    headerView.setUint32(20, entry.data.length, true)
    headerView.setUint32(24, entry.data.length, true)
    headerView.setUint16(28, name.length, true)
    headerView.setUint32(42, offset, true)
    header.set(name, 46)
    central.push(header)
    offset += local.length
  }
  const centralSize = central.reduce((total, part) => total + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)
  const total = [...chunks, ...central, end]
  const result = new Uint8Array(total.reduce((sum, part) => sum + part.length, 0))
  let cursor = 0
  for (const part of total) {
    result.set(part, cursor)
    cursor += part.length
  }
  return result
}

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
    storedEntry('ppt/presentation.xml', new TextEncoder().encode('<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>')),
    storedEntry('ppt/_rels/presentation.xml.rels', new TextEncoder().encode('<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>')),
    storedEntry('[Content_Types].xml', new TextEncoder().encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="emf" ContentType="image/x-emf"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>')),
    storedEntry('ppt/slides/slide1.xml', new TextEncoder().encode(slide)),
    storedEntry('ppt/slides/_rels/slide1.xml.rels', new TextEncoder().encode('<Relationships xmlns="r"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.emf"/></Relationships>')),
    storedEntry('ppt/media/image1.emf', emfBytes),
  ])
}

describe('EMF media import', () => {
  it('drops the EMF picture element entirely, losing it from the model', async () => {
    const document = await importPptx(packageWithEmfPicture())
    const slide = document.slides[document.slideOrder[0]!]!

    const kinds = slide.elementIds.map((id) => document.elements[id]?.kind)

    expect(kinds).toEqual(['text'])
    expect(Object.values(document.elements).some((element) => element.kind === 'image')).toBe(false)
    expect(document.assets).toBeUndefined()
  })

})

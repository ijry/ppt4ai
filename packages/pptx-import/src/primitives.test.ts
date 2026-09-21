import { describe, expect, it } from 'vitest'
import { readZipEntries } from './zip'
import { attribute, child, parseXml, textContent } from './xml'

function createStoredZip(name: string, value: string): Uint8Array {
  const encoder = new TextEncoder()
  const nameBytes = encoder.encode(name)
  const valueBytes = encoder.encode(value)
  const localSize = 30 + nameBytes.length + valueBytes.length
  const centralSize = 46 + nameBytes.length
  const output = new Uint8Array(localSize + centralSize + 22)
  const view = new DataView(output.buffer)
  const write16 = (offset: number, number: number) => view.setUint16(offset, number, true)
  const write32 = (offset: number, number: number) => view.setUint32(offset, number, true)

  write32(0, 0x04034b50)
  write16(8, 0)
  write32(18, valueBytes.length)
  write32(22, valueBytes.length)
  write16(26, nameBytes.length)
  output.set(nameBytes, 30)
  output.set(valueBytes, 30 + nameBytes.length)

  const centralOffset = localSize
  write32(centralOffset, 0x02014b50)
  write16(centralOffset + 10, 0)
  write32(centralOffset + 20, valueBytes.length)
  write32(centralOffset + 24, valueBytes.length)
  write16(centralOffset + 28, nameBytes.length)
  write32(centralOffset + 42, 0)
  output.set(nameBytes, centralOffset + 46)

  const endOffset = localSize + centralSize
  write32(endOffset, 0x06054b50)
  write16(endOffset + 8, 1)
  write16(endOffset + 10, 1)
  write32(endOffset + 12, centralSize)
  write32(endOffset + 16, centralOffset)
  return output
}

function createDeflatedZip(name: string, compressed: number[], uncompressedSize: number): Uint8Array {
  const encoder = new TextEncoder()
  const nameBytes = encoder.encode(name)
  const compressedBytes = Uint8Array.from(compressed)
  const localSize = 30 + nameBytes.length + compressedBytes.length
  const centralSize = 46 + nameBytes.length
  const output = new Uint8Array(localSize + centralSize + 22)
  const view = new DataView(output.buffer)
  const write16 = (offset: number, number: number) => view.setUint16(offset, number, true)
  const write32 = (offset: number, number: number) => view.setUint32(offset, number, true)

  write32(0, 0x04034b50)
  write16(8, 8)
  write32(18, compressedBytes.length)
  write32(22, uncompressedSize)
  write16(26, nameBytes.length)
  output.set(nameBytes, 30)
  output.set(compressedBytes, 30 + nameBytes.length)

  const centralOffset = localSize
  write32(centralOffset, 0x02014b50)
  write16(centralOffset + 10, 8)
  write32(centralOffset + 20, compressedBytes.length)
  write32(centralOffset + 24, uncompressedSize)
  write16(centralOffset + 28, nameBytes.length)
  write32(centralOffset + 42, 0)
  output.set(nameBytes, centralOffset + 46)

  const endOffset = localSize + centralSize
  write32(endOffset, 0x06054b50)
  write16(endOffset + 8, 1)
  write16(endOffset + 10, 1)
  write32(endOffset + 12, centralSize)
  write32(endOffset + 16, centralOffset)
  return output
}

describe('pptx import primitives', () => {
  it('reads a stored ZIP entry', async () => {
    const entries = await readZipEntries(createStoredZip('ppt/test.xml', '<a/>'))
    expect(new TextDecoder().decode(entries['ppt/test.xml'])).toBe('<a/>')
  })

  it('reads a deflated ZIP entry', async () => {
    const value = 'deflated text'
    const entries = await readZipEntries(createDeflatedZip('ppt/test.xml', [75, 73, 77, 203, 73, 44, 73, 77, 81, 40, 73, 173, 40, 1, 0], value.length))
    expect(new TextDecoder().decode(entries['ppt/test.xml'])).toBe(value)
  })

  it('parses namespaces, attributes, entities, and text', () => {
    const root = parseXml('<p:root xmlns:p="urn:p"><p:item a:x="1">A &amp; <b>B</b></p:item></p:root>')
    const item = child(root, 'root') && child(child(root, 'root')!, 'item')
    expect(item).toBeDefined()
    expect(attribute(item!, 'x')).toBe('1')
    expect(textContent(item!)).toBe('A & B')
  })
})

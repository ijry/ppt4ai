import { describe, expect, it } from 'vitest'
import { readZipEntries, writeStoredZip } from './zip.js'

function createSourceZip(): Uint8Array {
  const encoder = new TextEncoder()
  const entries = [
    { name: 'ppt/presentation.xml', data: encoder.encode('<p:presentation/>'), method: 0, compressed: encoder.encode('<p:presentation/>') },
    { name: 'ppt/media/image1.bin', data: Uint8Array.from([0, 255, 17, 128]), method: 0, compressed: Uint8Array.from([0, 255, 17, 128]) },
    { name: 'docProps/core.xml', data: encoder.encode('deflated text'), method: 8, compressed: Uint8Array.from([75, 73, 77, 203, 73, 44, 73, 77, 81, 40, 73, 173, 40, 1, 0]) },
  ]
  const nameBytes = entries.map((entry) => encoder.encode(entry.name))
  const localOffsets: number[] = []
  let localSize = 0
  for (let index = 0; index < entries.length; index += 1) {
    localOffsets.push(localSize)
    localSize += 30 + nameBytes[index]!.length + entries[index]!.compressed.length
  }
  const centralSize = entries.reduce((size, _, index) => size + 46 + nameBytes[index]!.length, 0)
  const output = new Uint8Array(localSize + centralSize + 22)
  const view = new DataView(output.buffer)
  const write16 = (offset: number, value: number) => view.setUint16(offset, value, true)
  const write32 = (offset: number, value: number) => view.setUint32(offset, value, true)

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!
    const offset = localOffsets[index]!
    const name = nameBytes[index]!
    write32(offset, 0x04034b50)
    write16(offset + 8, entry.method)
    write32(offset + 18, entry.compressed.length)
    write32(offset + 22, entry.data.length)
    write16(offset + 26, name.length)
    output.set(name, offset + 30)
    output.set(entry.compressed, offset + 30 + name.length)
  }

  let centralOffset = localSize
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!
    const name = nameBytes[index]!
    write32(centralOffset, 0x02014b50)
    write16(centralOffset + 10, entry.method)
    write32(centralOffset + 20, entry.compressed.length)
    write32(centralOffset + 24, entry.data.length)
    write16(centralOffset + 28, name.length)
    write32(centralOffset + 42, localOffsets[index]!)
    output.set(name, centralOffset + 46)
    centralOffset += 46 + name.length
  }

  write32(centralOffset, 0x06054b50)
  write16(centralOffset + 8, entries.length)
  write16(centralOffset + 10, entries.length)
  write32(centralOffset + 12, centralSize)
  write32(centralOffset + 16, localSize)
  return output
}

describe('PPTX ZIP writer', () => {
  it('reads stored and deflated entries in source order without changing binary data', async () => {
    const entries = await readZipEntries(createSourceZip())

    expect(entries.map((entry) => entry.name)).toEqual(['ppt/presentation.xml', 'ppt/media/image1.bin', 'docProps/core.xml'])
    expect(new TextDecoder().decode(entries[0]!.data)).toBe('<p:presentation/>')
    expect(entries[1]!.data).toEqual(Uint8Array.from([0, 255, 17, 128]))
    expect(new TextDecoder().decode(entries[2]!.data)).toBe('deflated text')
  })

  it('writes deterministic stored entries that round-trip in the same order', async () => {
    const entries = await readZipEntries(createSourceZip())
    const first = writeStoredZip(entries)
    const second = writeStoredZip(entries)

    expect(first).toEqual(second)
    await expect(readZipEntries(first)).resolves.toEqual(entries)
  })
})

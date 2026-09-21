const endOfCentralDirectorySignature = 0x06054b50
const centralDirectorySignature = 0x02014b50
const localFileHeaderSignature = 0x04034b50

export interface ZipEntry {
  name: string
  data: Uint8Array
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0)
    | ((bytes[offset + 1] ?? 0) << 8)
    | ((bytes[offset + 2] ?? 0) << 16)
    | ((bytes[offset + 3] ?? 0) << 24)) >>> 0
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true)
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true)
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const start = Math.max(0, bytes.length - 0xffff - 22)
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (readUint32(bytes, offset) === endOfCentralDirectorySignature) return offset
  }
  throw new Error('invalid ZIP: end of central directory not found')
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('deflated ZIP entries require DecompressionStream')
  const stream = new DecompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  await writer.write(new Uint8Array(bytes))
  await writer.close()
  return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}

export async function readZipEntries(bytes: Uint8Array): Promise<ZipEntry[]> {
  const endOffset = findEndOfCentralDirectory(bytes)
  const diskNumber = readUint16(bytes, endOffset + 4)
  const centralDisk = readUint16(bytes, endOffset + 6)
  const entryCount = readUint16(bytes, endOffset + 10)
  const centralEntryCount = readUint16(bytes, endOffset + 8)
  const centralDirectorySize = readUint32(bytes, endOffset + 12)
  const centralDirectoryOffset = readUint32(bytes, endOffset + 16)
  if (diskNumber !== 0 || centralDisk !== 0 || entryCount !== centralEntryCount) throw new Error('multi-disk ZIP packages are unsupported')
  if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) throw new Error('ZIP64 packages are unsupported')

  const decoder = new TextDecoder()
  const entries: ZipEntry[] = []
  let offset = centralDirectoryOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(bytes, offset) !== centralDirectorySignature) throw new Error(`invalid ZIP: central directory entry ${index} is malformed`)
    const flags = readUint16(bytes, offset + 8)
    const method = readUint16(bytes, offset + 10)
    const compressedSize = readUint32(bytes, offset + 20)
    const uncompressedSize = readUint32(bytes, offset + 24)
    const nameLength = readUint16(bytes, offset + 28)
    const extraLength = readUint16(bytes, offset + 30)
    const commentLength = readUint16(bytes, offset + 32)
    const localOffset = readUint32(bytes, offset + 42)
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength))
    offset += 46 + nameLength + extraLength + commentLength

    if ((flags & 0x01) !== 0) throw new Error(`encrypted ZIP entries are unsupported: ${name}`)
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || readUint32(bytes, localOffset) !== localFileHeaderSignature) throw new Error(`invalid ZIP local header: ${name}`)
    const localNameLength = readUint16(bytes, localOffset + 26)
    const localExtraLength = readUint16(bytes, localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const compressed = bytes.slice(dataStart, dataStart + compressedSize)
    const data = method === 0 ? compressed : method === 8 ? await inflateRaw(compressed) : undefined
    if (!data) throw new Error(`unsupported ZIP compression method ${method}: ${name}`)
    if (data.length !== uncompressedSize) throw new Error(`invalid ZIP size for ${name}`)
    entries.push({ name, data })
  }
  return entries
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  return crc >>> 0
})

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]!
  return (crc ^ 0xffffffff) >>> 0
}

export function writeStoredZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder()
  const names = entries.map((entry) => encoder.encode(entry.name))
  const localOffsets: number[] = []
  let localSize = 0
  for (let index = 0; index < entries.length; index += 1) {
    const data = entries[index]!.data
    const name = names[index]!
    if (data.length > 0xffffffff || name.length > 0xffff) throw new Error(`ZIP entry is too large: ${entries[index]!.name}`)
    localOffsets.push(localSize)
    localSize += 30 + name.length + data.length
  }
  const centralSize = entries.reduce((size, _, index) => size + 46 + names[index]!.length, 0)
  if (localSize > 0xffffffff || centralSize > 0xffffffff || localSize + centralSize + 22 > 0xffffffff) throw new Error('ZIP package is too large')
  const output = new Uint8Array(localSize + centralSize + 22)
  const view = new DataView(output.buffer)
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!
    const name = names[index]!
    const offset = localOffsets[index]!
    writeUint32(view, offset, localFileHeaderSignature)
    writeUint16(view, offset + 4, 20)
    writeUint16(view, offset + 6, 0x800)
    writeUint16(view, offset + 8, 0)
    writeUint32(view, offset + 14, crc32(entry.data))
    writeUint32(view, offset + 18, entry.data.length)
    writeUint32(view, offset + 22, entry.data.length)
    writeUint16(view, offset + 26, name.length)
    output.set(name, offset + 30)
    output.set(entry.data, offset + 30 + name.length)
  }
  let centralOffset = localSize
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!
    const name = names[index]!
    writeUint32(view, centralOffset, centralDirectorySignature)
    writeUint16(view, centralOffset + 4, 20)
    writeUint16(view, centralOffset + 6, 20)
    writeUint16(view, centralOffset + 8, 0x800)
    writeUint16(view, centralOffset + 10, 0)
    writeUint32(view, centralOffset + 16, crc32(entry.data))
    writeUint32(view, centralOffset + 20, entry.data.length)
    writeUint32(view, centralOffset + 24, entry.data.length)
    writeUint16(view, centralOffset + 28, name.length)
    writeUint32(view, centralOffset + 42, localOffsets[index]!)
    output.set(name, centralOffset + 46)
    centralOffset += 46 + name.length
  }
  writeUint32(view, centralOffset, endOfCentralDirectorySignature)
  writeUint16(view, centralOffset + 8, entries.length)
  writeUint16(view, centralOffset + 10, entries.length)
  writeUint32(view, centralOffset + 12, centralSize)
  writeUint32(view, centralOffset + 16, localSize)
  return output
}

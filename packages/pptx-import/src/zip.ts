const endOfCentralDirectorySignature = 0x06054b50
const centralDirectorySignature = 0x02014b50
const localFileHeaderSignature = 0x04034b50

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  await writer.write(new Uint8Array(bytes))
  await writer.close()
  return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const start = Math.max(0, bytes.length - 0xffff - 22)
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (readUint32(bytes, offset) === endOfCentralDirectorySignature) return offset
  }
  throw new Error('invalid ZIP: end of central directory not found')
}

export async function readZipEntries(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  const endOffset = findEndOfCentralDirectory(bytes)
  const entryCount = readUint16(bytes, endOffset + 10)
  const centralDirectoryOffset = readUint32(bytes, endOffset + 16)
  const entries: Record<string, Uint8Array> = {}
  let offset = centralDirectoryOffset

  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(bytes, offset) !== centralDirectorySignature) {
      throw new Error(`invalid ZIP: central directory entry ${index} is malformed`)
    }

    const flags = readUint16(bytes, offset + 8)
    const method = readUint16(bytes, offset + 10)
    const compressedSize = readUint32(bytes, offset + 20)
    const nameLength = readUint16(bytes, offset + 28)
    const extraLength = readUint16(bytes, offset + 30)
    const commentLength = readUint16(bytes, offset + 32)
    const localOffset = readUint32(bytes, offset + 42)
    const nameBytes = bytes.slice(offset + 46, offset + 46 + nameLength)
    const name = decodeUtf8(nameBytes)
    offset += 46 + nameLength + extraLength + commentLength

    if ((flags & 0x01) !== 0) throw new Error(`encrypted ZIP entries are unsupported: ${name}`)
    if (readUint32(bytes, localOffset) !== localFileHeaderSignature) {
      throw new Error(`invalid ZIP: local header is missing for ${name}`)
    }

    const localNameLength = readUint16(bytes, localOffset + 26)
    const localExtraLength = readUint16(bytes, localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const compressed = bytes.slice(dataStart, dataStart + compressedSize)

    if (method === 0) entries[name] = compressed
    else if (method === 8) entries[name] = await inflateRaw(compressed)
    else throw new Error(`unsupported ZIP compression method ${method}: ${name}`)
  }

  return entries
}

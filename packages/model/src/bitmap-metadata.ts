import type { ImageMimeType } from './index'

export interface BitmapMetadata {
  mimeType: ImageMimeType
  pixelWidth: number
  pixelHeight: number
}

function matchesBytes(bytes: Uint8Array, offset: number, signature: number[]): boolean {
  return offset >= 0 && offset + signature.length <= bytes.length && signature.every((value, index) => bytes[offset + index] === value)
}

function readBigEndianUint16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}

function readBigEndianUint32(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)) >>> 0
}

function readLittleEndianUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
}

function readLittleEndianUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24)) >>> 0
}

function readLittleEndianInt32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24)
}

function dimensions(mimeType: ImageMimeType, pixelWidth: number, pixelHeight: number): BitmapMetadata | undefined {
  return pixelWidth > 0 && pixelHeight > 0 ? { mimeType, pixelWidth, pixelHeight } : undefined
}

export function parseBitmapMetadata(bytes: Uint8Array): BitmapMetadata | undefined {
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length >= 24 && matchesBytes(bytes, 0, pngSignature)) {
    return dimensions('image/png', readBigEndianUint32(bytes, 16), readBigEndianUint32(bytes, 20))
  }

  if (bytes.length >= 10 && (matchesBytes(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || matchesBytes(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))) {
    return dimensions('image/gif', readLittleEndianUint16(bytes, 6), readLittleEndianUint16(bytes, 8))
  }

  if (bytes.length >= 26 && matchesBytes(bytes, 0, [0x42, 0x4d])) {
    const dibSize = readLittleEndianUint32(bytes, 14)
    if (dibSize < 12) return undefined
    return dimensions('image/bmp', readLittleEndianInt32(bytes, 18), Math.abs(readLittleEndianInt32(bytes, 22)))
  }

  if (bytes.length >= 20 && matchesBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && matchesBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50])) {
    if (bytes.length >= 30 && matchesBytes(bytes, 12, [0x56, 0x50, 0x38, 0x58])) {
      return dimensions('image/webp', 1 + (bytes[24] ?? 0) + ((bytes[25] ?? 0) << 8) + ((bytes[26] ?? 0) << 16), 1 + (bytes[27] ?? 0) + ((bytes[28] ?? 0) << 8) + ((bytes[29] ?? 0) << 16))
    }
    if (bytes.length >= 30 && matchesBytes(bytes, 12, [0x56, 0x50, 0x38, 0x20]) && matchesBytes(bytes, 23, [0x9d, 0x01, 0x2a])) {
      return dimensions('image/webp', readLittleEndianUint16(bytes, 26) & 0x3fff, readLittleEndianUint16(bytes, 28) & 0x3fff)
    }
    if (bytes.length >= 25 && matchesBytes(bytes, 12, [0x56, 0x50, 0x38, 0x4c]) && bytes[20] === 0x2f) {
      const bits = (bytes[21] ?? 0) | ((bytes[22] ?? 0) << 8) | ((bytes[23] ?? 0) << 16) | ((bytes[24] ?? 0) << 24)
      return dimensions('image/webp', 1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff))
    }
  }

  if (bytes.length >= 4 && matchesBytes(bytes, 0, [0xff, 0xd8, 0xff])) {
    let offset = 2
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xff) return undefined
      while (bytes[offset] === 0xff) offset += 1
      const marker = bytes[offset]
      if (marker === undefined) return undefined
      offset += 1
      if (marker === 0xd8 || marker === 0xd9) continue
      if (marker >= 0xd0 && marker <= 0xd7) continue
      if (offset + 1 >= bytes.length) return undefined
      const length = readBigEndianUint16(bytes, offset)
      if (length < 2 || offset + length > bytes.length) return undefined
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        if (length < 7) return undefined
        return dimensions('image/jpeg', readBigEndianUint16(bytes, offset + 5), readBigEndianUint16(bytes, offset + 3))
      }
      offset += length
    }
  }
  return undefined
}

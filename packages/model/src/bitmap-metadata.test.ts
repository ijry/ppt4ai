import { describe, expect, it } from 'vitest'
import { parseBitmapMetadata } from './bitmap-metadata'

describe('parseBitmapMetadata', () => {
  it('reads PNG dimensions without mutating bytes', () => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
      0, 0, 0, 12, 0, 0, 0, 34,
    ])
    const before = bytes.slice()
    expect(parseBitmapMetadata(bytes)).toEqual({
      mimeType: 'image/png', pixelWidth: 12, pixelHeight: 34,
    })
    expect(bytes).toEqual(before)
  })

  it.each([
    {
      name: 'JPEG',
      bytes: [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x18, 0x00, 0x28, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00],
      expected: { mimeType: 'image/jpeg', pixelWidth: 40, pixelHeight: 24 },
    },
    {
      name: 'GIF',
      bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x07, 0x00, 0x09, 0x00],
      expected: { mimeType: 'image/gif', pixelWidth: 7, pixelHeight: 9 },
    },
    {
      name: 'BMP',
      bytes: [0x42, 0x4d, 0, 0, 0, 0, 0, 0, 0, 0, 0x36, 0, 0, 0, 0x28, 0, 0, 0, 0x0b, 0, 0, 0, 0x0d, 0, 0, 0],
      expected: { mimeType: 'image/bmp', pixelWidth: 11, pixelHeight: 13 },
    },
    {
      name: 'WebP VP8X',
      bytes: [0x52, 0x49, 0x46, 0x46, 0x1e, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0x1f, 0, 0, 0x0f, 0, 0],
      expected: { mimeType: 'image/webp', pixelWidth: 32, pixelHeight: 16 },
    },
    {
      name: 'WebP VP8',
      bytes: [0x52, 0x49, 0x46, 0x46, 0x16, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 0x0a, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, 0x15, 0, 0x16, 0],
      expected: { mimeType: 'image/webp', pixelWidth: 21, pixelHeight: 22 },
    },
    {
      name: 'WebP VP8L',
      bytes: [0x52, 0x49, 0x46, 0x46, 0x11, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 0x05, 0, 0, 0, 0x2f, 0x10, 0x80, 0x04, 0],
      expected: { mimeType: 'image/webp', pixelWidth: 17, pixelHeight: 19 },
    },
  ] as const)('reads $name dimensions', ({ bytes, expected }) => {
    expect(parseBitmapMetadata(new Uint8Array(bytes))).toEqual(expected)
  })

  it.each([
    new Uint8Array([0x89, 0x50, 0x4e]),
    new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0]),
    new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 1]),
    new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
    new Uint8Array([0, 1, 2, 3]),
  ])('rejects malformed or unsupported bitmap data', (bytes) => {
    expect(parseBitmapMetadata(bytes)).toBeUndefined()
  })
})

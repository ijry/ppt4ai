import { describe, expect, it } from 'vitest'
import { ImageFileReadError, readImageUploadFile } from './image-file-upload'

const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

describe('readImageUploadFile', () => {
  it('copies supported file bytes and preserves its filename and MIME type', async () => {
    const file = new File([pngBytes], 'photo.png', { type: 'image/png' })

    const result = await readImageUploadFile(file)

    expect(result).toEqual({ data: pngBytes, mimeType: 'image/png', originalFilename: 'photo.png' })
    expect(result.data).not.toBe(pngBytes)
    result.data[0] = 0
    expect(pngBytes[0]).toBe(137)
  })

  it('omits empty or unsupported declared MIME types for byte sniffing', async () => {
    const empty = await readImageUploadFile(new File([pngBytes], 'photo.png'))
    const unsupported = await readImageUploadFile(new File([pngBytes], 'photo.png', { type: 'image/svg+xml' }))

    expect(empty.mimeType).toBeUndefined()
    expect(unsupported.mimeType).toBeUndefined()
  })

  it('wraps browser read failures without exposing the original error', async () => {
    const file = new File([pngBytes], 'photo.png', { type: 'image/png' })
    file.arrayBuffer = async () => { throw new Error('secret browser failure') }

    await expect(readImageUploadFile(file)).rejects.toBeInstanceOf(ImageFileReadError)
    await expect(readImageUploadFile(file)).rejects.not.toThrow('secret browser failure')
  })
})

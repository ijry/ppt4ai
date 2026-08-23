import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeBrowserImage } from './browser-image-decoder'

describe('browser image decoder', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('decodes copied bytes through createImageBitmap and exposes bitmap lifecycle', async () => {
    let capturedBlob: Blob | undefined
    const bitmap = {
      width: 320,
      height: 180,
      close: vi.fn(),
    } as unknown as ImageBitmap
    vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => {
      capturedBlob = blob
      return bitmap
    }))
    const data = new Uint8Array([1, 2, 3])

    const decoded = await decodeBrowserImage(data, 'image/png')
    data.fill(9)

    expect(capturedBlob?.type).toBe('image/png')
    expect([...new Uint8Array(await capturedBlob!.arrayBuffer())]).toEqual([1, 2, 3])
    expect(decoded).toMatchObject({ source: bitmap, width: 320, height: 180 })
    decoded.close?.()
    expect(bitmap.close).toHaveBeenCalledOnce()
  })

  it('rejects when createImageBitmap is unavailable', async () => {
    vi.stubGlobal('createImageBitmap', undefined)

    await expect(decodeBrowserImage(new Uint8Array([1]), 'image/png'))
      .rejects.toThrow('createImageBitmap is unavailable')
  })
})

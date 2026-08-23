import type { ImageMimeType } from '@ppt4ai/model'
import type { DecodedImage } from './image-canvas-renderer'

export async function decodeBrowserImage(data: Uint8Array, mimeType?: ImageMimeType): Promise<DecodedImage> {
  if (typeof globalThis.createImageBitmap !== 'function') {
    throw new Error('createImageBitmap is unavailable')
  }

  const bytes = new Uint8Array(data)
  const blob = new Blob([bytes], mimeType ? { type: mimeType } : undefined)
  const bitmap = await globalThis.createImageBitmap(blob)
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    close: bitmap.close.bind(bitmap),
  }
}

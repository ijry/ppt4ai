import type { ImageMimeType } from '@ppt4ai/model'

export interface PlaygroundImageUploadInput {
  data: Uint8Array
  mimeType?: ImageMimeType
  originalFilename?: string
}

export class ImageFileReadError extends Error {
  constructor() {
    super('failed to read image file')
    this.name = 'ImageFileReadError'
  }
}

const imageMimeTypes = new Set<ImageMimeType>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/bmp',
  'image/webp',
])

function supportedMimeType(value: string): ImageMimeType | undefined {
  return imageMimeTypes.has(value as ImageMimeType) ? value as ImageMimeType : undefined
}

export async function readImageUploadFile(file: File): Promise<PlaygroundImageUploadInput> {
  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch {
    throw new ImageFileReadError()
  }
  const mimeType = supportedMimeType(file.type)
  return {
    data: new Uint8Array(buffer).slice(),
    ...(mimeType ? { mimeType } : {}),
    ...(file.name ? { originalFilename: file.name } : {}),
  }
}

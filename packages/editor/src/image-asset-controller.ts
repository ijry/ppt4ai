import type { EditorEngine, EngineState } from '@ppt4ai/engine'
import { parseBitmapMetadata, type AssetAdapter, type AssetMetadata, type ImageMimeType, type Rect } from '@ppt4ai/model'

export interface ImageAssetControllerOptions {
  engine: EditorEngine
  assetAdapter: AssetAdapter
  assetIdFactory: () => string
}

export interface InsertImageAssetInput {
  slideId: string
  elementId: string
  bounds: Rect
  data: Uint8Array
  mimeType?: ImageMimeType
  originalFilename?: string
}

export interface ReplaceImageAssetInput {
  elementId: string
  data: Uint8Array
  mimeType?: ImageMimeType
  originalFilename?: string
}

export interface ImageAssetController {
  insert(input: InsertImageAssetInput): Promise<EngineState>
  replace(input: ReplaceImageAssetInput): Promise<EngineState>
}

export class ImageAssetControllerError extends Error {
  readonly orphanAssetIds: string[]

  constructor(message: string, options: { cause?: unknown; orphanAssetIds?: string[] } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ImageAssetControllerError'
    this.orphanAssetIds = [...(options.orphanAssetIds ?? [])]
  }
}

function prepareAsset(options: ImageAssetControllerOptions, data: Uint8Array, mimeType: ImageMimeType | undefined, originalFilename: string | undefined): { id: string; bytes: Uint8Array; metadata: AssetMetadata } {
  const parsed = parseBitmapMetadata(data)
  if (!parsed) throw new ImageAssetControllerError('unsupported or malformed bitmap data', { orphanAssetIds: [] })
  if (mimeType !== undefined && mimeType !== parsed.mimeType) {
    throw new ImageAssetControllerError(`declared image MIME does not match bitmap data: ${mimeType} != ${parsed.mimeType}`, { orphanAssetIds: [] })
  }
  const id = options.assetIdFactory()
  if (typeof id !== 'string' || id.length === 0) throw new ImageAssetControllerError('assetIdFactory must return a non-empty string', { orphanAssetIds: [] })
  const metadata: AssetMetadata = {
    id,
    ...parsed,
    ...(originalFilename === undefined ? {} : { originalFilename }),
  }
  return { id, bytes: data.slice(), metadata }
}

async function storeAsset(options: ImageAssetControllerOptions, prepared: { id: string; bytes: Uint8Array; metadata: AssetMetadata }): Promise<void> {
  try {
    await options.assetAdapter.put(prepared.id, prepared.bytes, structuredClone(prepared.metadata))
  } catch (cause) {
    throw new ImageAssetControllerError('failed to store image asset', { cause, orphanAssetIds: [] })
  }
}

export function createImageAssetController(options: ImageAssetControllerOptions): ImageAssetController {
  return {
    async insert(input): Promise<EngineState> {
      const prepared = prepareAsset(options, input.data, input.mimeType, input.originalFilename)
      await storeAsset(options, prepared)
      try {
        return options.engine.dispatch({
          type: 'insertImage',
          slideId: input.slideId,
          element: { id: input.elementId, kind: 'image', bounds: structuredClone(input.bounds), assetId: prepared.id },
          asset: prepared.metadata,
        })
      } catch (cause) {
        throw new ImageAssetControllerError('failed to insert image element', { cause, orphanAssetIds: [prepared.id] })
      }
    },

    async replace(input): Promise<EngineState> {
      const prepared = prepareAsset(options, input.data, input.mimeType, input.originalFilename)
      await storeAsset(options, prepared)
      try {
        return options.engine.dispatch({ type: 'replaceImageAsset', elementId: input.elementId, asset: prepared.metadata })
      } catch (cause) {
        throw new ImageAssetControllerError('failed to replace image asset', { cause, orphanAssetIds: [prepared.id] })
      }
    },
  }
}

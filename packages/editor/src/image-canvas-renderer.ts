import type { AssetAdapter, AssetMetadata, ImageMimeType } from '@ppt4ai/model'
import type { SceneGraph, SceneImageNode } from '@ppt4ai/render'
import { decodeBrowserImage } from './browser-image-decoder'
import { paintImageNode } from './image-painting'

const EMU_PER_CSS_PIXEL = 914400 / 96

export interface DecodedImage {
  source: CanvasImageSource
  width: number
  height: number
  close?: () => void
}

export type ImageDecoder = (data: Uint8Array, mimeType?: ImageMimeType) => Promise<DecodedImage>

export interface ImageViewport {
  zoom?: number
  devicePixelRatio?: number
  signal?: AbortSignal
}

export interface ImageRenderIssue {
  nodeId: string
  assetId: string
  code: 'missing-asset' | 'decode-failed' | 'draw-failed'
  message: string
}

export interface ImageRenderResult {
  drawnNodeIds: string[]
  skippedNodeIds: string[]
  issues: ImageRenderIssue[]
}

export interface ImageCanvasRendererOptions {
  adapter: AssetAdapter
  decoder?: ImageDecoder
  zoom?: number
  devicePixelRatio?: number
}

export interface ImageCanvasRenderer {
  render(
    scene: SceneGraph,
    context: CanvasRenderingContext2D,
    viewport?: ImageViewport,
  ): Promise<ImageRenderResult>
  clearCache(): void
  dispose(): void
}

type LoadOutcome =
  | { status: 'ready'; image: DecodedImage }
  | { status: 'failed'; code: 'missing-asset' | 'decode-failed'; message: string }

interface CacheEntry {
  promise: Promise<LoadOutcome>
  image?: DecodedImage
  closed: boolean
}

export type ImageLoadOutcome = LoadOutcome

/**
 * What the loader needs to fetch and decode: an id for the issue it reports, the asset key and the
 * MIME hint. `SceneImageNode` satisfies it structurally, and so does a shape node paired with its
 * picture fill — the cache is keyed by `assetId`, so a `p:pic` and a shape sharing one media part
 * decode once.
 */
export interface ImageLoadRequest {
  id: string
  assetId: string
  metadata?: AssetMetadata
}

export interface ImageNodeLoader {
  load(node: ImageLoadRequest): Promise<ImageLoadOutcome>
  clearCache(): void
  dispose(): void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function renderIssue(node: ImageLoadRequest, code: ImageRenderIssue['code'], error: unknown): ImageRenderIssue {
  return {
    nodeId: node.id,
    assetId: node.assetId,
    code,
    message: errorMessage(error),
  }
}

export function createImageNodeLoader(options: Pick<ImageCanvasRendererOptions, 'adapter' | 'decoder'>): ImageNodeLoader {
  const decoder = options.decoder ?? decodeBrowserImage
  const cache = new Map<string, CacheEntry>()
  let disposed = false

  const closeEntry = (entry: CacheEntry, image: DecodedImage): void => {
    if (entry.closed) return
    entry.closed = true
    entry.image = image
    image.close?.()
  }

  const load = (node: ImageLoadRequest): CacheEntry => {
    const existing = cache.get(node.assetId)
    if (existing) return existing

    const entry: CacheEntry = {
      promise: Promise.resolve({ status: 'failed', code: 'decode-failed', message: 'not loaded' }),
      closed: false,
    }
    entry.promise = options.adapter.get(node.assetId)
      .then(async (data): Promise<LoadOutcome> => {
        if (!data) return { status: 'failed', code: 'missing-asset', message: 'asset not found' }
        try {
          const image = await decoder(data, node.metadata?.mimeType)
          entry.image = image
          return { status: 'ready', image }
        } catch (error) {
          return { status: 'failed', code: 'decode-failed', message: errorMessage(error) }
        }
      })
      .catch((error): LoadOutcome => ({ status: 'failed', code: 'decode-failed', message: errorMessage(error) }))
    cache.set(node.assetId, entry)
    return entry
  }

  return {
    async load(node): Promise<ImageLoadOutcome> {
      if (disposed) throw new Error('renderer is disposed')
      return load(node).promise
    },
    clearCache(): void {
      const entries = [...cache.values()]
      cache.clear()
      for (const entry of entries) {
        if (entry.image) {
          closeEntry(entry, entry.image)
          continue
        }
        void entry.promise.then((outcome) => {
          if (outcome.status === 'ready') closeEntry(entry, outcome.image)
        })
      }
    },

    dispose(): void {
      disposed = true
      this.clearCache()
    },
  }
}

export function createImageCanvasRenderer(options: ImageCanvasRendererOptions): ImageCanvasRenderer {
  const loader = createImageNodeLoader(options)
  let disposed = false

  return {
    async render(scene, context, viewport = {}): Promise<ImageRenderResult> {
      if (disposed) throw new Error('renderer is disposed')
      if (viewport.signal?.aborted) return { drawnNodeIds: [], skippedNodeIds: [], issues: [] }

      const zoom = viewport.zoom ?? options.zoom ?? 1
      const devicePixelRatio = viewport.devicePixelRatio ?? options.devicePixelRatio ?? 1
      const cssWidth = scene.page.w / EMU_PER_CSS_PIXEL * zoom
      const cssHeight = scene.page.h / EMU_PER_CSS_PIXEL * zoom
      const canvas = context.canvas

      canvas.width = Math.round(cssWidth * devicePixelRatio)
      canvas.height = Math.round(cssHeight * devicePixelRatio)
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`

      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
      const backingScale = devicePixelRatio * 96 / 914400 * zoom
      context.setTransform(backingScale, 0, 0, backingScale, 0, 0)

      const imageNodes = scene.nodes.filter((node): node is SceneImageNode => node.kind === 'image')
      const loaded = await Promise.all(imageNodes.map(async (node) => ({ node, outcome: await loader.load(node) })))

      const result: ImageRenderResult = { drawnNodeIds: [], skippedNodeIds: [], issues: [] }
      for (const entry of loaded) {
        if (viewport.signal?.aborted) break
        if (entry.outcome.status === 'failed') {
          result.skippedNodeIds.push(entry.node.id)
          result.issues.push(renderIssue(entry.node, entry.outcome.code, entry.outcome.message))
          continue
        }
        try {
          paintImageNode(context, entry.node, entry.outcome.image, entry.node.bounds)
          result.drawnNodeIds.push(entry.node.id)
        } catch (error) {
          result.skippedNodeIds.push(entry.node.id)
          result.issues.push(renderIssue(entry.node, 'draw-failed', error))
        }
      }
      return result
    },
    clearCache: () => loader.clearCache(),
    dispose: () => {
      disposed = true
      loader.dispose()
    },
  }
}

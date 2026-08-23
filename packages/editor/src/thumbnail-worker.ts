import type { Rect } from '@ppt4ai/model'
import type { SceneGraph, SceneImageNode } from '@ppt4ai/render'
import { decodeBrowserImage } from './browser-image-decoder'
import { paintImageNode } from './image-painting'
import type { DecodedImage, ImageDecoder } from './image-canvas-renderer'
import {
  isThumbnailMessage,
  type ThumbnailRenderRequest,
  type ThumbnailRenderResponse,
  type ThumbnailResourceRequest,
  type ThumbnailResourceResponse,
  type ThumbnailWorkerRequest,
  type ThumbnailWorkerResponse,
} from './thumbnail-protocol'

export interface ThumbnailWorkerRuntimeDeps {
  createCanvas(width: number, height: number): OffscreenCanvas
  decode: ImageDecoder
  post(message: ThumbnailWorkerResponse, transfer?: Transferable[]): void
}

export interface ThumbnailWorkerRuntime {
  handleMessage(message: ThumbnailWorkerRequest): void
  dispose(): void
}

interface PendingResource {
  requestId: number
  resourceRequestId: number
  resolve: (response: ThumbnailResourceResponse) => void
  reject: (error: unknown) => void
}

interface AssetCacheEntry {
  promise: Promise<DecodedImage>
  image?: DecodedImage
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function issue(node: SceneImageNode, code: 'missing-asset' | 'resource-failed' | 'decode-failed' | 'draw-failed', error: unknown) {
  return {
    nodeId: node.id,
    assetId: node.assetId,
    code,
    message: errorMessage(error),
  }
}

function mapBounds(
  scene: SceneGraph,
  node: SceneImageNode,
  width: number,
  height: number,
): Rect {
  const scale = Math.min(width / scene.page.w, height / scene.page.h)
  const offsetX = (width - scene.page.w * scale) / 2
  const offsetY = (height - scene.page.h * scale) / 2
  return {
    x: offsetX + node.bounds.x * scale,
    y: offsetY + node.bounds.y * scale,
    w: node.bounds.w * scale,
    h: node.bounds.h * scale,
  }
}

export function createThumbnailWorkerRuntime(deps: ThumbnailWorkerRuntimeDeps): ThumbnailWorkerRuntime {
  let canvas: OffscreenCanvas | undefined
  let disposed = false
  let activeRequestId: number | undefined
  let resourceRequestId = 0
  const cancelled = new Set<number>()
  const pendingResources = new Map<string, PendingResource>()
  const cache = new Map<string, AssetCacheEntry>()

  const isCancelled = (requestId: number): boolean => disposed || cancelled.has(requestId) || activeRequestId !== requestId

  const closeImage = (image: DecodedImage | undefined): void => {
    image?.close?.()
  }

  const clearCache = (): void => {
    for (const entry of cache.values()) closeImage(entry.image)
    cache.clear()
  }

  const requestResource = (request: ThumbnailRenderRequest, node: SceneImageNode): Promise<ThumbnailResourceResponse> => {
    const id = ++resourceRequestId
    return new Promise<ThumbnailResourceResponse>((resolve, reject) => {
      pendingResources.set(`${request.requestId}:${id}`, {
        requestId: request.requestId,
        resourceRequestId: id,
        resolve,
        reject,
      })
      const resourceRequest: ThumbnailResourceRequest = {
        type: 'resource-request',
        requestId: request.requestId,
        resourceRequestId: id,
        assetId: node.assetId,
        ...(node.metadata?.mimeType ? { mimeType: node.metadata.mimeType } : {}),
        ...(request.resourceContext ? { resourceContext: request.resourceContext } : {}),
      }
      deps.post(resourceRequest)
    })
  }

  const loadAsset = async (request: ThumbnailRenderRequest, node: SceneImageNode): Promise<DecodedImage> => {
    const existing = cache.get(node.assetId)
    if (existing) return existing.promise

    const promise = requestResource(request, node).then(async (response) => {
      if (response.error) {
        throw Object.assign(new Error(response.error.message), { thumbnailCode: response.error.code })
      }
      if (!response.data) throw new Error('resource response has no data')
      return deps.decode(response.data, response.mimeType ?? node.metadata?.mimeType)
    })
    const entry: AssetCacheEntry = { promise }
    cache.set(node.assetId, entry)
    promise.then((image) => { entry.image = image }).catch(() => {
      if (cache.get(node.assetId) === entry) cache.delete(node.assetId)
    })
    return promise
  }

  const render = async (request: ThumbnailRenderRequest): Promise<void> => {
    if (isCancelled(request.requestId)) return
    const width = Math.max(1, Math.round(request.viewport.width))
    const height = Math.max(1, Math.round(request.viewport.height))
    try {
      canvas ??= deps.createCanvas(width, height)
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('OffscreenCanvas 2D context is unavailable')
      context.clearRect(0, 0, width, height)

      const drawnNodeIds: string[] = []
      const skippedNodeIds: string[] = []
      const issues: ThumbnailRenderResponse['result']['issues'] = []
      for (const node of request.scene.nodes) {
        if (isCancelled(request.requestId)) return
        if (node.kind !== 'image') continue
        try {
          const image = await loadAsset(request, node)
          if (isCancelled(request.requestId)) return
          paintImageNode(context, node, image, mapBounds(request.scene, node, width, height))
          drawnNodeIds.push(node.id)
        } catch (error) {
          if (isCancelled(request.requestId)) return
          const code = (error as { thumbnailCode?: string }).thumbnailCode
          const issueCode = code === 'missing-asset' || code === 'resource-failed'
            ? code
            : error instanceof Error && error.message.includes('decode') ? 'decode-failed' : 'draw-failed'
          skippedNodeIds.push(node.id)
          issues.push(issue(node, issueCode, error))
        }
      }
      if (isCancelled(request.requestId)) return
      const bitmap = canvas.transferToImageBitmap()
      const response: ThumbnailRenderResponse = {
        type: 'render-result',
        requestId: request.requestId,
        bitmap,
        result: { drawnNodeIds, skippedNodeIds, issues },
      }
      deps.post(response, [bitmap])
    } catch (error) {
      if (isCancelled(request.requestId)) return
      deps.post({
        type: 'render-result',
        requestId: request.requestId,
        result: {
          drawnNodeIds: [],
          skippedNodeIds: [],
          issues: [{ nodeId: '', code: 'worker-failed', message: errorMessage(error) }],
        },
      })
    }
  }

  const handleResourceResponse = (response: ThumbnailResourceResponse): void => {
    const pending = pendingResources.get(`${response.requestId}:${response.resourceRequestId}`)
    if (!pending) return
    pendingResources.delete(`${response.requestId}:${response.resourceRequestId}`)
    pending.resolve(response)
  }

  return {
    handleMessage(message) {
      if (disposed || !isThumbnailMessage(message)) return
      if (message.type === 'resource-response') {
        handleResourceResponse(message)
      } else if (message.type === 'cancel') {
        cancelled.add(message.requestId)
        if (activeRequestId === message.requestId) activeRequestId = undefined
        for (const [key, pending] of pendingResources) {
          if (pending.requestId !== message.requestId) continue
          pendingResources.delete(key)
          pending.reject(new Error('thumbnail render cancelled'))
        }
      } else if (message.type === 'render') {
        if (activeRequestId !== undefined && activeRequestId !== message.requestId) cancelled.add(activeRequestId)
        activeRequestId = message.requestId
        void render(message)
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const pending of pendingResources.values()) pending.reject(new Error('thumbnail worker disposed'))
      pendingResources.clear()
      clearCache()
      canvas = undefined
    },
  }
}

export function createThumbnailWorkerEntry(): void {
  const scope = globalThis as unknown as {
    onmessage: ((event: MessageEvent<ThumbnailWorkerRequest>) => void) | null
    postMessage(message: ThumbnailWorkerResponse, transfer: Transferable[]): void
  }
  const runtime = createThumbnailWorkerRuntime({
    createCanvas: (width, height) => new OffscreenCanvas(width, height),
    decode: decodeBrowserImage,
    post: (message, transfer) => scope.postMessage(message, transfer ?? []),
  })
  scope.onmessage = (event: MessageEvent<ThumbnailWorkerRequest>) => runtime.handleMessage(event.data)
}

if (typeof document === 'undefined' && typeof OffscreenCanvas !== 'undefined') createThumbnailWorkerEntry()

import type { AssetAdapter, ImageMimeType } from '@ppt4ai/model'
import type { SceneGraph, SceneImageNode } from '@ppt4ai/render'
import {
  isThumbnailMessage,
  type ThumbnailRenderResult,
  type ThumbnailRenderResponse,
  type ThumbnailResourceRequest,
  type ThumbnailResourceResponse,
  type ThumbnailViewport,
  type ThumbnailWorkerRequest,
} from './thumbnail-protocol'

export interface ThumbnailWorkerPort {
  postMessage(message: unknown, transfer?: Transferable[]): void
  terminate(): void
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

export interface ThumbnailWorkerFactory {
  create(): ThumbnailWorkerPort
}

export interface ThumbnailRendererOptions {
  adapter: AssetAdapter
  workerFactory?: ThumbnailWorkerFactory
  resourceContext?: string
}

export interface ThumbnailRenderer {
  render(scene: SceneGraph, canvas: HTMLCanvasElement, viewport: ThumbnailViewport): Promise<ThumbnailRenderResult>
  cancel(): void
  dispose(): void
}

export class ThumbnailRendererError extends Error {
  readonly code: 'worker-failed'

  constructor(message: string) {
    super(message)
    this.name = 'ThumbnailRendererError'
    this.code = 'worker-failed'
  }
}

interface ActiveRender {
  requestId: number
  resolve: (result: ThumbnailRenderResult) => void
  reject: (error: unknown) => void
  canvas: HTMLCanvasElement
  context: ImageBitmapRenderingContext
}

function sceneMimeType(scene: SceneGraph | undefined, assetId: string): ImageMimeType | undefined {
  const node = scene?.nodes.find((entry): entry is SceneImageNode => entry.kind === 'image' && entry.assetId === assetId)
  return node?.metadata?.mimeType
}

const DEFAULT_FACTORY: ThumbnailWorkerFactory = {
  create: () => new Worker(new URL('./thumbnail-worker.ts', import.meta.url), { type: 'module' }),
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 500) || 'unknown error'
}

function abortError(): DOMException {
  return new DOMException('thumbnail render cancelled', 'AbortError')
}

function positivePixels(value: number, devicePixelRatio: number): number {
  return Math.max(1, Math.round(value * devicePixelRatio))
}

export function createThumbnailRenderer(options: ThumbnailRendererOptions): ThumbnailRenderer {
  const worker = (options.workerFactory ?? DEFAULT_FACTORY).create()
  let nextRequestId = 0
  let active: ActiveRender | undefined
  let activeScene: SceneGraph | undefined
  let disposed = false

  const rejectActive = (error: unknown): void => {
    const current = active
    if (!current) return
    active = undefined
    activeScene = undefined
    current.reject(error)
  }

  const postResourceResponse = async (request: ThumbnailResourceRequest): Promise<void> => {
    if (disposed || !active || active.requestId !== request.requestId) return
    const mimeType = request.mimeType ?? sceneMimeType(activeScene, request.assetId)
    try {
      const data = await options.adapter.get(request.assetId)
      if (disposed || !active || active.requestId !== request.requestId) return
      if (!data) {
        const response: ThumbnailResourceResponse = {
          type: 'resource-response', requestId: request.requestId,
          resourceRequestId: request.resourceRequestId, assetId: request.assetId,
          ...(mimeType ? { mimeType } : {}),
          error: { code: 'missing-asset', message: 'asset not found' },
        }
        worker.postMessage(response)
        return
      }
      const copied = new Uint8Array(data)
      const response: ThumbnailResourceResponse = {
        type: 'resource-response', requestId: request.requestId,
        resourceRequestId: request.resourceRequestId, assetId: request.assetId,
        data: copied,
        ...(mimeType ? { mimeType } : {}),
      }
      worker.postMessage(response, [copied.buffer])
    } catch (error) {
      if (disposed || !active || active.requestId !== request.requestId) return
      const response: ThumbnailResourceResponse = {
        type: 'resource-response', requestId: request.requestId,
        resourceRequestId: request.resourceRequestId, assetId: request.assetId,
        ...(mimeType ? { mimeType } : {}),
        error: { code: 'resource-failed', message: errorMessage(error) },
      }
      worker.postMessage(response)
    }
  }

  worker.onmessage = (event) => {
    if (disposed || !isThumbnailMessage(event.data)) return
    if (event.data.type === 'resource-request') {
      void postResourceResponse(event.data)
      return
    }
    if (event.data.type !== 'render-result') return
    const response = event.data as ThumbnailRenderResponse
    if (!active || response.requestId !== active.requestId) {
      response.bitmap?.close()
      return
    }
    const current = active
    active = undefined
    activeScene = undefined
    try {
      if (response.bitmap) {
        current.context.transferFromImageBitmap(response.bitmap)
        response.bitmap.close()
      }
      current.resolve(response.result)
    } catch (error) {
      response.bitmap?.close()
      current.reject(new ThumbnailRendererError(errorMessage(error)))
    }
  }

  worker.onerror = (event) => {
    if (disposed) return
    rejectActive(new ThumbnailRendererError(errorMessage(event.message)))
  }

  return {
    render(scene, canvas, viewport) {
      if (disposed) return Promise.reject(new Error('thumbnail renderer is disposed'))
      this.cancel()
      const devicePixelRatio = viewport.devicePixelRatio ?? 1
      const width = positivePixels(viewport.width, devicePixelRatio)
      const height = positivePixels(viewport.height, devicePixelRatio)
      const context = canvas.getContext('bitmaprenderer')
      if (!context) return Promise.reject(new ThumbnailRendererError('bitmaprenderer context is unavailable'))
      canvas.width = width
      canvas.height = height
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      const requestId = ++nextRequestId
      const request: ThumbnailWorkerRequest = {
        type: 'render', requestId,
        scene: structuredClone(scene),
        viewport: { ...viewport, width, height },
        ...(options.resourceContext ? { resourceContext: options.resourceContext } : {}),
      }
      return new Promise<ThumbnailRenderResult>((resolve, reject) => {
        active = { requestId, resolve, reject, canvas, context }
        activeScene = scene
        try {
          worker.postMessage(request)
        } catch (error) {
          rejectActive(new ThumbnailRendererError(errorMessage(error)))
        }
      })
    },
    cancel() {
      if (!active) return
      const requestId = active.requestId
      rejectActive(abortError())
      if (!disposed) worker.postMessage({ type: 'cancel', requestId })
    },
    dispose() {
      if (disposed) return
      disposed = true
      rejectActive(abortError())
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    },
  }
}

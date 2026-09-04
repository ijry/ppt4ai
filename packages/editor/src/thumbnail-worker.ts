import type { Rect, ResolvedColor, ResolvedGradient } from '@ppt4ai/model'
import { gradientAxis } from '@ppt4ai/geometry'
import type { SceneGraph, SceneImageNode, SceneShapeNode, SceneTableNode, SceneTextNode } from '@ppt4ai/render'
import { decodeBrowserImage } from './browser-image-decoder'
import { paintImageNode } from './image-painting'
import { paintShapeNode, type ShapePageMapping } from './shape-painting'
import { paintTableNode } from './table-painting'
import { paintTextNode } from './text-painting'
import type { DecodedImage, ImageDecoder, ImageLoadRequest } from './image-canvas-renderer'
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

function issue(
  node: SceneImageNode | SceneShapeNode | SceneTableNode | SceneTextNode,
  code: 'missing-asset' | 'resource-failed' | 'decode-failed' | 'draw-failed',
  error: unknown,
) {
  return {
    nodeId: node.id,
    ...(node.kind === 'image' ? { assetId: node.assetId } : {}),
    code,
    message: errorMessage(error),
  }
}

function pageMapping(
  scene: SceneGraph,
  width: number,
  height: number,
): ShapePageMapping {
  const scale = Math.min(width / scene.page.w, height / scene.page.h)
  return {
    scale,
    offsetX: (width - scene.page.w * scale) / 2,
    offsetY: (height - scene.page.h * scale) / 2,
  }
}

function mapBounds(bounds: Rect, mapping: ShapePageMapping): Rect {
  return {
    x: mapping.offsetX + bounds.x * mapping.scale,
    y: mapping.offsetY + bounds.y * mapping.scale,
    w: bounds.w * mapping.scale,
    h: bounds.h * mapping.scale,
  }
}

function colorStyle(color: ResolvedColor): { style: string; alpha: number } {
  return { style: `#${color.rgb.toUpperCase()}`, alpha: color.alpha / 100000 }
}

function rgbaStyle(hex: string, alpha: number): string {
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function createBackgroundGradient(
  context: OffscreenCanvasRenderingContext2D,
  gradient: ResolvedGradient,
  bounds: Rect,
): CanvasGradient {
  const axis = gradientAxis(bounds, gradient.angle ?? 0, gradient.scaled ?? false)
  const canvasGradient = context.createLinearGradient(axis.from.x, axis.from.y, axis.to.x, axis.to.y)
  for (const stop of gradient.stops) {
    const { style, alpha } = colorStyle(stop.color)
    const offset = Math.min(1, Math.max(0, stop.pos / 100000))
    canvasGradient.addColorStop(offset, alpha >= 1 ? style : rgbaStyle(style, alpha))
  }
  return canvasGradient
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

  const requestResource = (request: ThumbnailRenderRequest, node: ImageLoadRequest): Promise<ThumbnailResourceResponse> => {
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

  const loadAsset = async (request: ThumbnailRenderRequest, node: ImageLoadRequest): Promise<DecodedImage> => {
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
      const mapping = pageMapping(request.scene, width, height)

      const drawnNodeIds: string[] = []
      const skippedNodeIds: string[] = []
      const issues: ThumbnailRenderResponse['result']['issues'] = []
      // Same order the canvas renderer uses: the page fill goes down before any node.
      const background = request.scene.background
      if (background) {
        const bgBounds = { x: mapping.offsetX, y: mapping.offsetY, w: request.scene.page.w * mapping.scale, h: request.scene.page.h * mapping.scale }
        if (request.scene.backgroundGradient) {
          context.fillStyle = createBackgroundGradient(context, request.scene.backgroundGradient, bgBounds)
        } else {
          context.fillStyle = `#${background.rgb.toUpperCase()}`
          context.globalAlpha = background.alpha / 100000
        }
        context.fillRect(bgBounds.x, bgBounds.y, bgBounds.w, bgBounds.h)
        context.globalAlpha = 1
      }
      for (const node of request.scene.nodes) {
        if (isCancelled(request.requestId)) return
        if (node.kind !== 'shape' && node.kind !== 'text' && node.kind !== 'table' && node.kind !== 'image') continue
        try {
          if (node.kind === 'shape' || node.kind === 'text') {
            // Same policy the slide renderer uses: a picture fill that will not load costs the fill,
            // not the node, so the outline and any text still reach the thumbnail.
            let picture: DecodedImage | undefined
            if (node.pictureFill) {
              try {
                picture = await loadAsset(request, {
                  id: node.id,
                  assetId: node.pictureFill.assetId,
                  ...(node.pictureFill.metadata ? { metadata: node.pictureFill.metadata } : {}),
                })
              } catch (error) {
                if (isCancelled(request.requestId)) return
                const code = (error as { thumbnailCode?: string }).thumbnailCode
                issues.push(issue(node, code === 'missing-asset' || code === 'resource-failed' ? code : 'decode-failed', error))
              }
              if (isCancelled(request.requestId)) return
            }
            if (node.kind === 'shape') paintShapeNode(context, node, mapping, picture)
            else paintTextNode(context, node, mapping, picture)
          } else if (node.kind === 'table') {
            paintTableNode(context, node, mapping)
          } else {
            const image = await loadAsset(request, node)
            if (isCancelled(request.requestId)) return
            paintImageNode(context, node, image, mapBounds(node.bounds, mapping))
          }
          drawnNodeIds.push(node.id)
        } catch (error) {
          if (isCancelled(request.requestId)) return
          const code = node.kind === 'image' ? (error as { thumbnailCode?: string }).thumbnailCode : undefined
          const issueCode = code === 'missing-asset' || code === 'resource-failed'
            ? code
            : node.kind === 'image' && error instanceof Error && error.message.includes('decode') ? 'decode-failed' : 'draw-failed'
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

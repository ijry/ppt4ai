import type { ImageMimeType } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'

export type ThumbnailIssueCode =
  | 'missing-asset'
  | 'resource-failed'
  | 'decode-failed'
  | 'draw-failed'
  | 'worker-failed'

export interface ThumbnailViewport {
  width: number
  height: number
  devicePixelRatio?: number
}

export interface ThumbnailRenderResult {
  drawnNodeIds: string[]
  skippedNodeIds: string[]
  issues: Array<{
    nodeId: string
    assetId?: string
    code: ThumbnailIssueCode
    message: string
  }>
}

export interface ThumbnailRenderRequest {
  type: 'render'
  requestId: number
  scene: SceneGraph
  viewport: ThumbnailViewport
  resourceContext?: string
}

export interface ThumbnailCancelRequest {
  type: 'cancel'
  requestId: number
}

export interface ThumbnailResourceRequest {
  type: 'resource-request'
  requestId: number
  resourceRequestId: number
  assetId: string
  mimeType?: ImageMimeType
  resourceContext?: string
}

export interface ThumbnailResourceResponse {
  type: 'resource-response'
  requestId: number
  resourceRequestId: number
  assetId: string
  data?: Uint8Array
  mimeType?: ImageMimeType
  error?: {
    code: 'missing-asset' | 'resource-failed'
    message: string
  }
}

export interface ThumbnailRenderResponse {
  type: 'render-result'
  requestId: number
  bitmap?: ImageBitmap
  result: ThumbnailRenderResult
}

export type ThumbnailWorkerRequest =
  | ThumbnailRenderRequest
  | ThumbnailCancelRequest
  | ThumbnailResourceResponse

export type ThumbnailWorkerResponse = ThumbnailResourceRequest | ThumbnailRenderResponse

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isViewport(value: unknown): value is ThumbnailViewport {
  if (!isRecord(value) || !isPositiveInteger(value.width) || !isPositiveInteger(value.height)) return false
  return value.devicePixelRatio === undefined
    || (typeof value.devicePixelRatio === 'number' && Number.isFinite(value.devicePixelRatio) && value.devicePixelRatio > 0)
}

function isRenderRequest(value: Record<string, unknown>): boolean {
  return value.type === 'render'
    && isPositiveInteger(value.requestId)
    && isRecord(value.scene)
    && isViewport(value.viewport)
}

function isCancelRequest(value: Record<string, unknown>): boolean {
  return value.type === 'cancel' && isPositiveInteger(value.requestId)
}

function isResourceResponse(value: Record<string, unknown>): boolean {
  const hasData = value.data instanceof Uint8Array
  const hasError = isRecord(value.error)
    && (value.error.code === 'missing-asset' || value.error.code === 'resource-failed')
    && typeof value.error.message === 'string'
  return value.type === 'resource-response'
    && isPositiveInteger(value.requestId)
    && isPositiveInteger(value.resourceRequestId)
    && typeof value.assetId === 'string'
    && (hasData || hasError)
}

export function isThumbnailMessage(value: unknown): value is ThumbnailWorkerRequest | ThumbnailWorkerResponse {
  if (!isRecord(value)) return false
  if (value.type === 'render') return isRenderRequest(value)
  if (value.type === 'cancel') return isCancelRequest(value)
  if (value.type === 'resource-response') return isResourceResponse(value)
  if (value.type === 'resource-request') {
    return isPositiveInteger(value.requestId)
      && isPositiveInteger(value.resourceRequestId)
      && typeof value.assetId === 'string'
  }
  if (value.type === 'render-result') {
    return isPositiveInteger(value.requestId) && isRecord(value.result)
  }
  return false
}

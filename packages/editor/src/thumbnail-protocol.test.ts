import { describe, expect, it } from 'vitest'
import { isThumbnailMessage, type ThumbnailRenderRequest, type ThumbnailResourceResponse } from './thumbnail-protocol'

describe('thumbnail protocol', () => {
  it('accepts clone-safe render requests with a positive request id', () => {
    const message: ThumbnailRenderRequest = {
      type: 'render',
      requestId: 1,
      scene: {
        slideId: 'slide-1',
        page: { w: 914400, h: 514350 },
        nodes: [{
          id: 'leaf-1',
          kind: 'shape',
          bounds: { x: 0, y: 0, w: 100, h: 100 },
          path: [],
        }],
        groups: [
          { id: 'outer', bounds: { x: 0, y: 0, w: 200, h: 200 }, childIds: ['inner'], ancestorIds: [], paintOrder: 0 },
          { id: 'inner', bounds: { x: 0, y: 0, w: 100, h: 100 }, childIds: ['leaf-1'], ancestorIds: ['outer'], paintOrder: 0 },
        ],
      },
      viewport: { width: 96, height: 54 },
    }

    const cloned = structuredClone(message)
    expect(isThumbnailMessage(cloned)).toBe(true)
    expect(cloned.scene.groups).toEqual(message.scene.groups)
    expect(isThumbnailMessage({ ...message, requestId: 0 })).toBe(false)
  })

  it('rejects unknown messages and incomplete resource responses', () => {
    const resourceResponse: ThumbnailResourceResponse = {
      type: 'resource-response',
      requestId: 1,
      resourceRequestId: 1,
      assetId: 'asset-1',
      data: new Uint8Array([1, 2, 3]),
    }

    expect(isThumbnailMessage(structuredClone(resourceResponse))).toBe(true)
    expect(isThumbnailMessage({ type: 'unknown' })).toBe(false)
    expect(isThumbnailMessage({
      ...resourceResponse,
      data: undefined,
      error: undefined,
    })).toBe(false)
  })
})

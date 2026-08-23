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
        nodes: [],
      },
      viewport: { width: 96, height: 54 },
    }

    expect(isThumbnailMessage(structuredClone(message))).toBe(true)
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

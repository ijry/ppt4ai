import type { ImageMimeType } from '@ppt4ai/model'
import { describe, expect, it, vi } from 'vitest'
import type { DecodedImage } from './image-canvas-renderer'
import {
  createThumbnailWorkerRuntime,
  type ThumbnailWorkerRuntime,
  type ThumbnailWorkerRuntimeDeps,
} from './thumbnail-worker'
import type {
  ThumbnailRenderRequest,
  ThumbnailRenderResponse,
  ThumbnailResourceRequest,
  ThumbnailResourceResponse,
  ThumbnailWorkerResponse,
} from './thumbnail-protocol'

class FakeContext {
  readonly draws: unknown[][] = []
  globalAlpha = 1
  filter = 'none'
  save(): void {}
  restore(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  beginPath(): void {}
  rect(): void {}
  roundRect(): void {}
  ellipse(): void {}
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  clip(): void {}
  drawImage(...args: unknown[]): void { this.draws.push(args) }
  clearRect(): void {}
}

class FakeCanvas {
  readonly context = new FakeContext()
  width = 0
  height = 0
  readonly bitmap = { close: () => {} } as unknown as ImageBitmap
  getContext(): OffscreenCanvasRenderingContext2D { return this.context as unknown as OffscreenCanvasRenderingContext2D }
  transferToImageBitmap(): ImageBitmap { return this.bitmap }
}

function scene(): ThumbnailRenderRequest['scene'] {
  return {
    slideId: 'slide-1',
    page: { w: 1000, h: 500 },
    nodes: [
      { id: 'first', kind: 'image', bounds: { x: 0, y: 0, w: 500, h: 500 }, assetId: 'asset-a', metadata: { id: 'asset-a', mimeType: 'image/png' } },
      { id: 'second', kind: 'image', bounds: { x: 500, y: 0, w: 500, h: 500 }, assetId: 'asset-a', metadata: { id: 'asset-a', mimeType: 'image/png' } },
    ],
  }
}

function createHarness(): {
  runtime: ThumbnailWorkerRuntime
  canvas: FakeCanvas
  messages: ThumbnailWorkerResponse[]
  decodeCalls: Array<{ data: Uint8Array; mimeType?: ImageMimeType }>
  deps: ThumbnailWorkerRuntimeDeps
} {
  const canvas = new FakeCanvas()
  const messages: ThumbnailWorkerResponse[] = []
  const decodeCalls: Array<{ data: Uint8Array; mimeType?: ImageMimeType }> = []
  const deps: ThumbnailWorkerRuntimeDeps = {
    createCanvas: () => canvas as unknown as OffscreenCanvas,
    decode: async (data, mimeType): Promise<DecodedImage> => {
      decodeCalls.push({ data, ...(mimeType ? { mimeType } : {}) })
      return { source: { id: 'decoded' } as unknown as CanvasImageSource, width: 100, height: 100 }
    },
    post: (message) => { messages.push(message) },
  }
  return { runtime: createThumbnailWorkerRuntime(deps), canvas, messages, decodeCalls, deps }
}

async function resolveResource(runtime: ThumbnailWorkerRuntime, messages: ThumbnailWorkerResponse[], data = [1, 2, 3]): Promise<void> {
  const request = messages.find((message): message is ThumbnailResourceRequest => message.type === 'resource-request')
  expect(request).toBeDefined()
  const response: ThumbnailResourceResponse = {
    type: 'resource-response',
    requestId: request!.requestId,
    resourceRequestId: request!.resourceRequestId,
    assetId: request!.assetId,
    data: new Uint8Array(data),
    ...(request!.mimeType ? { mimeType: request!.mimeType } : {}),
  }
  runtime.handleMessage(response)
  await Promise.resolve()
  await Promise.resolve()
}

describe('thumbnail worker runtime', () => {
  it('deduplicates resources, paints in order, and transfers a bitmap', async () => {
    const harness = createHarness()
    const request: ThumbnailRenderRequest = {
      type: 'render',
      requestId: 1,
      scene: scene(),
      viewport: { width: 200, height: 100 },
    }

    harness.runtime.handleMessage(request)
    await resolveResource(harness.runtime, harness.messages)
    await vi.waitFor(() => {
      expect(harness.messages.some((message) => message.type === 'render-result')).toBe(true)
    })
    const result = harness.messages.find((message): message is ThumbnailRenderResponse => message.type === 'render-result')

    expect(harness.decodeCalls).toHaveLength(1)
    expect(harness.decodeCalls[0]?.mimeType).toBe('image/png')
    expect(harness.canvas.context.draws).toHaveLength(2)
    expect(result?.result.drawnNodeIds).toEqual(['first', 'second'])
    expect(result?.result.issues).toEqual([])
  })

  it('suppresses a cancelled request while waiting for its resource', async () => {
    const harness = createHarness()
    harness.runtime.handleMessage({
      type: 'render',
      requestId: 2,
      scene: scene(),
      viewport: { width: 200, height: 100 },
    })
    harness.runtime.handleMessage({ type: 'cancel', requestId: 2 })
    await resolveResource(harness.runtime, harness.messages)

    expect(harness.messages.some((message) => message.type === 'render-result')).toBe(false)
  })

  it('isolates missing resources and decode failures from later images', async () => {
    const harness = createHarness()
    harness.deps.decode = async (data): Promise<DecodedImage> => {
      if (data[0] === 9) throw new Error('bitmap decode failed')
      return { source: { id: 'decoded' } as unknown as CanvasImageSource, width: 100, height: 100 }
    }
    const request: ThumbnailRenderRequest = {
      type: 'render',
      requestId: 3,
      scene: {
        ...scene(),
        nodes: [
          { id: 'missing', kind: 'image', bounds: { x: 0, y: 0, w: 300, h: 500 }, assetId: 'missing', metadata: { id: 'missing', mimeType: 'image/png' } },
          { id: 'bad', kind: 'image', bounds: { x: 300, y: 0, w: 300, h: 500 }, assetId: 'bad', metadata: { id: 'bad', mimeType: 'image/png' } },
          { id: 'good', kind: 'image', bounds: { x: 600, y: 0, w: 400, h: 500 }, assetId: 'good', metadata: { id: 'good', mimeType: 'image/png' } },
        ],
      },
      viewport: { width: 200, height: 100 },
    }

    harness.runtime.handleMessage(request)
    const firstRequest = harness.messages.find((message): message is ThumbnailResourceRequest => message.type === 'resource-request')
    expect(firstRequest?.assetId).toBe('missing')
    harness.runtime.handleMessage({
      type: 'resource-response',
      requestId: 3,
      resourceRequestId: firstRequest!.resourceRequestId,
      assetId: 'missing',
      error: { code: 'missing-asset', message: 'asset not found' },
    })
    await vi.waitFor(() => expect(harness.messages.filter((message) => message.type === 'resource-request')).toHaveLength(2))
    const secondRequest = harness.messages.filter((message): message is ThumbnailResourceRequest => message.type === 'resource-request')[1]!
    harness.runtime.handleMessage({
      type: 'resource-response',
      requestId: 3,
      resourceRequestId: secondRequest.resourceRequestId,
      assetId: 'bad',
      data: new Uint8Array([9]),
      mimeType: 'image/png',
    })
    await vi.waitFor(() => expect(harness.messages.filter((message) => message.type === 'resource-request')).toHaveLength(3))
    const thirdRequest = harness.messages.filter((message): message is ThumbnailResourceRequest => message.type === 'resource-request')[2]!
    harness.runtime.handleMessage({
      type: 'resource-response',
      requestId: 3,
      resourceRequestId: thirdRequest.resourceRequestId,
      assetId: 'good',
      data: new Uint8Array([1]),
      mimeType: 'image/png',
    })
    await vi.waitFor(() => expect(harness.messages.some((message) => message.type === 'render-result')).toBe(true))

    const result = harness.messages.find((message): message is ThumbnailRenderResponse => message.type === 'render-result')!
    expect(result.result.skippedNodeIds).toEqual(['missing', 'bad'])
    expect(result.result.drawnNodeIds).toEqual(['good'])
    expect(result.result.issues.map((entry) => entry.code)).toEqual(['missing-asset', 'decode-failed'])
  })
})

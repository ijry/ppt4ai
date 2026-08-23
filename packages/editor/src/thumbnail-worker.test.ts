import type { ImageMimeType } from '@ppt4ai/model'
import type { SceneTableNode } from '@ppt4ai/render'
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
  readonly events: unknown[][] = []
  globalAlpha = 1
  filter = 'none'
  fillStyle = ''
  strokeStyle = ''
  font = ''
  textAlign: CanvasTextAlign = 'start'
  textBaseline: CanvasTextBaseline = 'alphabetic'
  lineWidth = 1
  lineCap: CanvasLineCap = 'butt'
  save(): void { this.events.push(['save']) }
  restore(): void { this.events.push(['restore']) }
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  beginPath(): void { this.events.push(['beginPath']) }
  rect(...args: unknown[]): void { this.events.push(['rect', ...args]) }
  roundRect(): void {}
  ellipse(...args: unknown[]): void { this.events.push(['ellipse', ...args]) }
  moveTo(...args: unknown[]): void { this.events.push(['moveTo', ...args]) }
  lineTo(...args: unknown[]): void { this.events.push(['lineTo', ...args]) }
  closePath(): void { this.events.push(['closePath']) }
  fill(): void { this.events.push(['fill', this.fillStyle, this.globalAlpha]) }
  stroke(): void { this.events.push(['stroke', this.strokeStyle, this.globalAlpha]) }
  setLineDash(...args: unknown[]): void { this.events.push(['setLineDash', ...args]) }
  fillText(text: string, x: number, y: number): void {
    this.events.push(['fillText', text, x, y, this.font, this.fillStyle, this.globalAlpha])
  }
  clip(): void {}
  drawImage(...args: unknown[]): void {
    this.draws.push(args)
    this.events.push(['drawImage'])
  }
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

function tableNode(id: string, text = 'Cell', fillRgb = '336699'): SceneTableNode {
  return {
    id,
    kind: 'table',
    bounds: { x: 200, y: 0, w: 200, h: 100 },
    layout: {
      bounds: { x: 200, y: 0, w: 200, h: 100 },
      columns: [200],
      rows: [100],
      borders: [],
      cells: [{
        row: 0,
        column: 0,
        rowSpan: 1,
        colSpan: 1,
        bounds: { x: 200, y: 0, w: 200, h: 100 },
        body: { paragraphs: [] },
        borders: {},
        resolvedFillColor: { rgb: fillRgb, alpha: 100000 },
        resolvedStyle: { borders: { left: { color: { type: 'srgb', v: '000000' }, width: 1, style: 'solid' } } },
        resolvedBorderColors: { left: { rgb: '000000', alpha: 100000 } },
        textLayout: {
          bounds: { x: 210, y: 10, w: 180, h: 80 },
          fontScale: 100000,
          overflow: false,
          contentBounds: { x: 210, y: 10, w: 180, h: 80 },
          lines: text.length === 0 ? [] : [{
            paragraphIndex: 0,
            x: 210,
            y: 10,
            width: 180,
            height: 20,
            runs: [{ text, x: 210, width: 180, marks: { fontSize: 1 } }],
          }],
        },
      }],
    },
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
  it('paints tables with surrounding nodes in scene order without table resources', async () => {
    const harness = createHarness()
    harness.runtime.handleMessage({
      type: 'render',
      requestId: 8,
      scene: {
        slideId: 'slide-1',
        page: { w: 1000, h: 500 },
        nodes: [
          {
            id: 'shape-before',
            kind: 'shape',
            bounds: { x: 0, y: 0, w: 200, h: 100 },
            path: [{ type: 'move', x: 0, y: 0 }, { type: 'line', x: 200, y: 0 }, { type: 'close' }],
            resolvedFillColor: { rgb: '112233', alpha: 100000 },
          },
          tableNode('table-middle'),
          {
            id: 'text-after',
            kind: 'text',
            bounds: { x: 400, y: 0, w: 200, h: 100 },
            text: 'After',
            layout: {
              bounds: { x: 400, y: 0, w: 200, h: 100 },
              fontScale: 100000,
              overflow: false,
              contentBounds: { x: 400, y: 0, w: 200, h: 100 },
              lines: [{ paragraphIndex: 0, x: 400, y: 0, width: 200, height: 20, runs: [{ text: 'After', x: 400, width: 200, marks: { fontSize: 1 } }] }],
            },
          },
        ],
      },
      viewport: { width: 200, height: 100 },
    })
    await vi.waitFor(() => expect(harness.messages.some((message) => message.type === 'render-result')).toBe(true))

    const result = harness.messages.find((message): message is ThumbnailRenderResponse => message.type === 'render-result')!
    const paintEvents = harness.canvas.context.events.filter(([type]) => type === 'fill' || type === 'stroke' || type === 'fillText')
    expect(paintEvents.map(([type, value]) => type === 'fillText' ? value : type)).toEqual(['fill', 'fill', 'stroke', 'Cell', 'After'])
    expect(result.result.drawnNodeIds).toEqual(['shape-before', 'table-middle', 'text-after'])
    expect(result.result.skippedNodeIds).toEqual([])
    expect(harness.messages.filter((message) => message.type === 'resource-request')).toHaveLength(0)
  })

  it('isolates invalid tables, draws later nodes and empty tables, and requests no resources', async () => {
    const harness = createHarness()
    const emptyTable = tableNode('empty-table', '')
    emptyTable.layout.cells = []
    harness.runtime.handleMessage({
      type: 'render',
      requestId: 9,
      scene: {
        slideId: 'slide-1',
        page: { w: 1000, h: 500 },
        nodes: [
          tableNode('bad-table', 'Bad', 'broken'),
          {
            id: 'shape-after',
            kind: 'shape',
            bounds: { x: 400, y: 0, w: 200, h: 100 },
            path: [{ type: 'move', x: 400, y: 0 }, { type: 'line', x: 600, y: 0 }, { type: 'close' }],
            resolvedFillColor: { rgb: '112233', alpha: 100000 },
          },
          emptyTable,
        ],
      },
      viewport: { width: 200, height: 100 },
    })
    await vi.waitFor(() => expect(harness.messages.some((message) => message.type === 'render-result')).toBe(true))

    const result = harness.messages.find((message): message is ThumbnailRenderResponse => message.type === 'render-result')!
    expect(result.result.drawnNodeIds).toEqual(['shape-after', 'empty-table'])
    expect(result.result.skippedNodeIds).toEqual(['bad-table'])
    expect(result.result.issues).toMatchObject([{ nodeId: 'bad-table', code: 'draw-failed' }])
    expect(harness.messages.filter((message) => message.type === 'resource-request')).toHaveLength(0)
  })

  it('paints mixed shape, text, and image nodes in scene order without text resources', async () => {
    const harness = createHarness()
    const textNode = (id: string, text: string, x: number): ThumbnailRenderRequest['scene']['nodes'][number] => ({
      id,
      kind: 'text',
      bounds: { x, y: 0, w: 200, h: 100 },
      text,
      layout: {
        bounds: { x, y: 0, w: 200, h: 100 },
        fontScale: 100000,
        overflow: false,
        contentBounds: { x, y: 0, w: 200, h: 100 },
        lines: text.length === 0 ? [] : [{
          paragraphIndex: 0,
          x,
          y: 0,
          width: 200,
          height: 100,
          runs: [{ text, x, width: 200 }],
        }],
      },
    })
    const request: ThumbnailRenderRequest = {
      type: 'render',
      requestId: 6,
      scene: {
        slideId: 'slide-1',
        page: { w: 1000, h: 500 },
        nodes: [
          {
            id: 'shape-first',
            kind: 'shape',
            bounds: { x: 0, y: 0, w: 200, h: 100 },
            path: [{ type: 'move', x: 0, y: 0 }, { type: 'line', x: 200, y: 0 }, { type: 'close' }],
            resolvedFillColor: { rgb: '112233', alpha: 100000 },
          },
          textNode('text-middle', 'Hello', 200),
          { id: 'image-third', kind: 'image', bounds: { x: 400, y: 0, w: 200, h: 100 }, assetId: 'asset-a', metadata: { id: 'asset-a', mimeType: 'image/png' } },
          textNode('text-last', 'World', 600),
        ],
      },
      viewport: { width: 200, height: 100 },
    }

    harness.runtime.handleMessage(request)
    await resolveResource(harness.runtime, harness.messages)
    await vi.waitFor(() => expect(harness.messages.some((message) => message.type === 'render-result')).toBe(true))

    const result = harness.messages.find((message): message is ThumbnailRenderResponse => message.type === 'render-result')!
    const paintEvents = harness.canvas.context.events.filter(([type]) => type === 'fill' || type === 'fillText' || type === 'drawImage' || type === 'stroke')
    expect(paintEvents.map((event) => event[0] === 'fillText' ? event[1] : event[0])).toEqual(['fill', 'Hello', 'drawImage', 'World'])
    expect(result.result.drawnNodeIds).toEqual(['shape-first', 'text-middle', 'image-third', 'text-last'])
    expect(result.result.skippedNodeIds).toEqual([])
    expect(harness.messages.filter((message) => message.type === 'resource-request')).toHaveLength(1)
  })

  it('draws empty text, isolates invalid text, and never requests text resources', async () => {
    const harness = createHarness()
    const baseText = {
      kind: 'text' as const,
      bounds: { x: 0, y: 0, w: 100, h: 100 },
      text: 'x',
      layout: {
        bounds: { x: 0, y: 0, w: 100, h: 100 },
        fontScale: 100000,
        overflow: false,
        contentBounds: { x: 0, y: 0, w: 100, h: 100 },
        lines: [{ paragraphIndex: 0, x: 0, y: 0, width: 100, height: 100, runs: [{ text: 'x', x: 0, width: 100 }] }],
      },
    }
    harness.runtime.handleMessage({
      type: 'render',
      requestId: 7,
      scene: {
        slideId: 'slide-1',
        page: { w: 100, h: 100 },
        nodes: [
          { ...baseText, id: 'empty-text', text: '', layout: { ...baseText.layout, lines: [] } },
          { ...baseText, id: 'bad-text', layout: { ...baseText.layout, lines: [{ ...baseText.layout.lines[0]!, runs: [{ text: 'bad', x: 0, width: 100, resolvedColor: { rgb: 'broken', alpha: 100000 } }] }] } },
          { ...baseText, id: 'good-text', text: 'good' },
        ],
      },
      viewport: { width: 100, height: 100 },
    })
    await vi.waitFor(() => expect(harness.messages.some((message) => message.type === 'render-result')).toBe(true))

    const result = harness.messages.find((message): message is ThumbnailRenderResponse => message.type === 'render-result')!
    expect(result.result.drawnNodeIds).toEqual(['empty-text', 'good-text'])
    expect(result.result.skippedNodeIds).toEqual(['bad-text'])
    expect(result.result.issues).toMatchObject([{ nodeId: 'bad-text', code: 'draw-failed' }])
    expect(harness.messages.filter((message) => message.type === 'resource-request')).toHaveLength(0)
  })

  it('paints shapes and images in scene order without requesting shape assets', async () => {
    const harness = createHarness()
    const request: ThumbnailRenderRequest = {
      type: 'render',
      requestId: 4,
      scene: {
        slideId: 'slide-1',
        page: { w: 1000, h: 500 },
        nodes: [
          {
            id: 'shape-behind',
            kind: 'shape',
            bounds: { x: 0, y: 0, w: 1000, h: 500 },
            path: [
              { type: 'move', x: 0, y: 0 },
              { type: 'line', x: 1000, y: 0 },
              { type: 'line', x: 1000, y: 500 },
              { type: 'close' },
            ],
            resolvedFillColor: { rgb: '112233', alpha: 100000 },
          },
          {
            id: 'image-middle',
            kind: 'image',
            bounds: { x: 250, y: 0, w: 500, h: 500 },
            assetId: 'asset-a',
            metadata: { id: 'asset-a', mimeType: 'image/png' },
          },
          {
            id: 'shape-front',
            kind: 'shape',
            bounds: { x: 250, y: 125, w: 500, h: 250 },
            path: [
              { type: 'move', x: 250, y: 125 },
              { type: 'line', x: 750, y: 125 },
              { type: 'line', x: 500, y: 375 },
              { type: 'close' },
            ],
            resolvedStrokeColor: { rgb: 'AABBCC', alpha: 100000 },
          },
        ],
      },
      viewport: { width: 200, height: 100 },
    }

    harness.runtime.handleMessage(request)
    const resource = harness.messages.find((message): message is ThumbnailResourceRequest => message.type === 'resource-request')
    expect(resource?.assetId).toBe('asset-a')
    harness.runtime.handleMessage({
      type: 'resource-response',
      requestId: 4,
      resourceRequestId: resource!.resourceRequestId,
      assetId: 'asset-a',
      data: new Uint8Array([1]),
      mimeType: 'image/png',
    })
    await vi.waitFor(() => expect(harness.messages.some((message) => message.type === 'render-result')).toBe(true))

    const result = harness.messages.find((message): message is ThumbnailRenderResponse => message.type === 'render-result')!
    const paintEvents = harness.canvas.context.events.filter(([type]) => type === 'fill' || type === 'stroke')
    expect(result.result.drawnNodeIds).toEqual(['shape-behind', 'image-middle', 'shape-front'])
    expect(paintEvents).toEqual([
      ['fill', '#112233', 1],
      ['stroke', '#AABBCC', 1],
    ])
    expect(harness.canvas.context.draws).toHaveLength(1)
    expect(harness.messages.filter((message) => message.type === 'resource-request')).toHaveLength(1)
  })

  it('isolates shape failures from later valid shapes', async () => {
    const harness = createHarness()
    harness.runtime.handleMessage({
      type: 'render',
      requestId: 5,
      scene: {
        slideId: 'slide-1',
        page: { w: 100, h: 100 },
        nodes: [
          {
            id: 'bad-shape',
            kind: 'shape',
            bounds: { x: 0, y: 0, w: 50, h: 50 },
            path: [{ type: 'move', x: 0, y: 0 }, { type: 'line', x: Number.NaN, y: 50 }],
            resolvedFillColor: { rgb: 'broken', alpha: 100000 },
          },
          {
            id: 'good-shape',
            kind: 'shape',
            bounds: { x: 50, y: 50, w: 50, h: 50 },
            path: [{ type: 'move', x: 50, y: 50 }, { type: 'line', x: 100, y: 50 }, { type: 'close' }],
            resolvedFillColor: { rgb: '336699', alpha: 100000 },
          },
        ],
      },
      viewport: { width: 100, height: 100 },
    })
    await vi.waitFor(() => expect(harness.messages.some((message) => message.type === 'render-result')).toBe(true))

    const result = harness.messages.find((message): message is ThumbnailRenderResponse => message.type === 'render-result')!
    expect(result.result.skippedNodeIds).toEqual(['bad-shape'])
    expect(result.result.drawnNodeIds).toEqual(['good-shape'])
    expect(result.result.issues).toMatchObject([{ nodeId: 'bad-shape', code: 'draw-failed' }])
    expect(harness.messages.filter((message) => message.type === 'resource-request')).toHaveLength(0)
  })

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

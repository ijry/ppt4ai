import type { AssetAdapter, AssetMetadata } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import { describe, expect, it, vi } from 'vitest'
import type { DecodedImage } from './image-canvas-renderer'
import { createSlideCanvasRenderer } from './slide-canvas-renderer'
import { createThumbnailWorkerRuntime, type ThumbnailWorkerRuntime } from './thumbnail-worker'
import type { ThumbnailRenderResponse, ThumbnailResourceRequest, ThumbnailResourceResponse, ThumbnailWorkerResponse } from './thumbnail-protocol'

/** `bytes` has no default: passing an explicit `undefined` to a defaulted parameter would fill it in. */
class RecordingAdapter implements AssetAdapter {
  readonly getCalls: string[] = []
  constructor(private readonly bytes?: Uint8Array) {}
  async get(assetId: string): Promise<Uint8Array | undefined> {
    this.getCalls.push(assetId)
    return this.bytes
  }
  async put(_assetId: string, _data: Uint8Array, _metadata: AssetMetadata): Promise<void> {}
}

type Event = [string, ...unknown[]]

function createRecordingContext(): CanvasRenderingContext2D & { events: Event[]; canvas: HTMLCanvasElement } {
  const events: Event[] = []
  const canvas = { width: 0, height: 0, style: { width: '', height: '' } }
  const record = (name: string) => (...values: unknown[]): void => { events.push([name, ...values]) }
  return {
    canvas,
    events,
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    filter: 'none',
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    ellipse: record('ellipse'),
    rect: record('rect'),
    roundRect: record('roundRect'),
    fill: record('fill'),
    stroke: record('stroke'),
    clip: record('clip'),
    fillText: record('fillText'),
    drawImage: record('drawImage'),
    translate: record('translate'),
    rotate: record('rotate'),
    scale: record('scale'),
    setLineDash: record('setLineDash'),
    clearRect: record('clearRect'),
    fillRect: record('fillRect'),
    setTransform: record('setTransform'),
  } as unknown as CanvasRenderingContext2D & { events: Event[]; canvas: HTMLCanvasElement }
}

const metadata: AssetMetadata = { id: 'asset_photo', mimeType: 'image/png' }

function filledShape(): SceneGraph['nodes'][number] {
  return {
    id: 'shape-1',
    kind: 'shape',
    bounds: { x: 0, y: 0, w: 914400, h: 914400 },
    path: [{ type: 'move', x: 0, y: 0 }, { type: 'line', x: 914400, y: 914400 }, { type: 'close' }],
    pictureFill: { assetId: 'asset_photo', metadata },
    resolvedStrokeColor: { rgb: '203864', alpha: 100000 },
  }
}

function sceneWith(...nodes: SceneGraph['nodes']): SceneGraph {
  return { slideId: 'slide-1', page: { w: 9144000, h: 5143500 }, nodes }
}

const decoder = async (): Promise<DecodedImage> => ({ source: { id: 'photo' } as unknown as CanvasImageSource, width: 40, height: 20 })

describe('picture fill on the slide canvas renderer', () => {
  it('loads the fill media and draws it', async () => {
    const context = createRecordingContext()
    const adapter = new RecordingAdapter(new Uint8Array([7]))
    const renderer = createSlideCanvasRenderer({ adapter, decoder })

    const result = await renderer.render(sceneWith(filledShape()), context)

    expect(adapter.getCalls).toEqual(['asset_photo'])
    expect(context.events.some(([name]) => name === 'drawImage')).toBe(true)
    expect(result.drawnNodeIds).toEqual(['shape-1'])
    expect(result.issues).toEqual([])
  })

  /**
   * Decision 4's failure half: the photo is only the shape's fill, so losing it must not take the
   * outline with it. A `p:pic` node legitimately skips whole, because there the picture *is* the node.
   */
  it('reports a missing asset and still paints the outline', async () => {
    const context = createRecordingContext()
    const renderer = createSlideCanvasRenderer({ adapter: new RecordingAdapter(), decoder })

    const result = await renderer.render(sceneWith(filledShape()), context)

    expect(result.issues).toEqual([{ nodeId: 'shape-1', kind: 'shape', code: 'missing-asset', message: 'asset not found' }])
    expect(result.drawnNodeIds).toEqual(['shape-1'])
    expect(result.skippedNodeIds).toEqual([])
    expect(context.events.some(([name]) => name === 'drawImage')).toBe(false)
    expect(context.events.some(([name]) => name === 'stroke')).toBe(true)
  })

  it('decodes once when a picture and a shape share the media', async () => {
    const context = createRecordingContext()
    const adapter = new RecordingAdapter(new Uint8Array([7]))
    let decodes = 0
    const renderer = createSlideCanvasRenderer({
      adapter,
      decoder: async (): Promise<DecodedImage> => {
        decodes += 1
        return { source: { id: 'photo' } as unknown as CanvasImageSource, width: 40, height: 20 }
      },
    })

    const result = await renderer.render(sceneWith(
      filledShape(),
      { id: 'image-1', kind: 'image', bounds: { x: 0, y: 0, w: 100, h: 100 }, assetId: 'asset_photo', metadata },
    ), context)

    expect(adapter.getCalls).toEqual(['asset_photo'])
    expect(decodes).toBe(1)
    expect(result.drawnNodeIds).toEqual(['shape-1', 'image-1'])
  })
})

class FakeContext {
  readonly events: Event[] = []
  globalAlpha = 1
  filter = 'none'
  fillStyle = ''
  strokeStyle = ''
  font = ''
  textAlign: CanvasTextAlign = 'start'
  textBaseline: CanvasTextBaseline = 'alphabetic'
  lineWidth = 1
  lineCap: CanvasLineCap = 'butt'
  lineJoin: CanvasLineJoin = 'miter'
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
  fill(): void { this.events.push(['fill']) }
  stroke(): void { this.events.push(['stroke']) }
  setLineDash(): void {}
  fillText(): void {}
  clip(): void { this.events.push(['clip']) }
  drawImage(...args: unknown[]): void { this.events.push(['drawImage', ...args]) }
  clearRect(): void {}
}

class FakeCanvas {
  readonly context = new FakeContext()
  width = 0
  height = 0
  getContext(): OffscreenCanvasRenderingContext2D { return this.context as unknown as OffscreenCanvasRenderingContext2D }
  transferToImageBitmap(): ImageBitmap { return { close: () => {} } as unknown as ImageBitmap }
}

function createWorker(): { runtime: ThumbnailWorkerRuntime; canvas: FakeCanvas; messages: ThumbnailWorkerResponse[] } {
  const canvas = new FakeCanvas()
  const messages: ThumbnailWorkerResponse[] = []
  const runtime = createThumbnailWorkerRuntime({
    createCanvas: () => canvas as unknown as OffscreenCanvas,
    decode: async (): Promise<DecodedImage> => ({ source: { id: 'decoded' } as unknown as CanvasImageSource, width: 40, height: 20 }),
    post: (message) => { messages.push(message) },
  })
  return { runtime, canvas, messages }
}

function resourceRequest(messages: ThumbnailWorkerResponse[]): ThumbnailResourceRequest | undefined {
  return messages.find((message): message is ThumbnailResourceRequest => message.type === 'resource-request')
}

function renderResult(messages: ThumbnailWorkerResponse[]): ThumbnailRenderResponse | undefined {
  return messages.find((message): message is ThumbnailRenderResponse => message.type === 'render-result')
}

describe('picture fill in the thumbnail worker', () => {
  it('asks the host for the fill media and draws it', async () => {
    const { runtime, canvas, messages } = createWorker()
    runtime.handleMessage({ type: 'render', requestId: 1, scene: sceneWith(filledShape()), viewport: { width: 200, height: 100 } })
    await vi.waitFor(() => expect(resourceRequest(messages)).toBeDefined())

    const request = resourceRequest(messages)!
    expect(request.assetId).toBe('asset_photo')
    const response: ThumbnailResourceResponse = {
      type: 'resource-response',
      requestId: request.requestId,
      resourceRequestId: request.resourceRequestId,
      assetId: request.assetId,
      data: new Uint8Array([1, 2, 3]),
    }
    runtime.handleMessage(response)
    await vi.waitFor(() => expect(renderResult(messages)).toBeDefined())

    expect(canvas.context.events.some(([name]) => name === 'drawImage')).toBe(true)
    expect(renderResult(messages)!.result.drawnNodeIds).toEqual(['shape-1'])
    expect(renderResult(messages)!.result.issues).toEqual([])
  })

  it('reports the failure and still paints the shape', async () => {
    const { runtime, canvas, messages } = createWorker()
    runtime.handleMessage({ type: 'render', requestId: 2, scene: sceneWith(filledShape()), viewport: { width: 200, height: 100 } })
    await vi.waitFor(() => expect(resourceRequest(messages)).toBeDefined())

    const request = resourceRequest(messages)!
    runtime.handleMessage({
      type: 'resource-response',
      requestId: request.requestId,
      resourceRequestId: request.resourceRequestId,
      assetId: request.assetId,
      error: { code: 'missing-asset', message: 'asset not found' },
    })
    await vi.waitFor(() => expect(renderResult(messages)).toBeDefined())

    const result = renderResult(messages)!.result
    expect(result.drawnNodeIds).toEqual(['shape-1'])
    expect(result.skippedNodeIds).toEqual([])
    expect(result.issues).toEqual([{ nodeId: 'shape-1', code: 'missing-asset', message: 'asset not found' }])
    expect(canvas.context.events.some(([name]) => name === 'drawImage')).toBe(false)
    expect(canvas.context.events.some(([name]) => name === 'stroke')).toBe(true)
  })
})

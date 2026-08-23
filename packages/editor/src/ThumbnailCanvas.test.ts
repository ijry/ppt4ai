// @vitest-environment happy-dom
import type { AssetAdapter } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import { createApp, h, nextTick, reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ThumbnailCanvas from './ThumbnailCanvas.vue'
import type { ThumbnailWorkerPort } from './thumbnail-renderer'
import type { ThumbnailRenderResponse, ThumbnailWorkerRequest } from './thumbnail-protocol'

class TestWorker implements ThumbnailWorkerPort {
  readonly posts: ThumbnailWorkerRequest[] = []
  terminateCalls = 0
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postMessage(message: unknown): void { this.posts.push(message as ThumbnailWorkerRequest) }
  terminate(): void { this.terminateCalls += 1 }
  emit(response: ThumbnailRenderResponse): void { this.onmessage?.({ data: response } as MessageEvent) }
}

const adapter: AssetAdapter = { get: async () => undefined, put: async () => {} }

function scene(id: string): SceneGraph {
  return { slideId: id, page: { w: 1000, h: 500 }, nodes: [] }
}

function result(requestId: number, id: string): ThumbnailRenderResponse {
  return { type: 'render-result', requestId, result: { drawnNodeIds: [id], skippedNodeIds: [], issues: [] } }
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('ThumbnailCanvas', () => {
  it('rerenders latest props, emits results, and disposes on unmount', async () => {
    const worker = new TestWorker()
    const bitmapContext = { transferFromImageBitmap: vi.fn() }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(bitmapContext as unknown as RenderingContext)
    const state = reactive({ scene: scene('old'), width: 120, height: 68 })
    const events: unknown[] = []
    const app = createApp({
      setup: () => () => h(ThumbnailCanvas, {
        scene: state.scene,
        adapter,
        width: state.width,
        height: state.height,
        devicePixelRatio: 2,
        resourceContext: 'document-1',
        workerFactory: { create: () => worker },
        onRender: (value: unknown) => events.push(value),
      }),
    })
    const host = document.createElement('div')
    document.body.append(host)
    app.mount(host)
    await nextTick()

    const canvas = host.querySelector('canvas[data-thumbnail-canvas]') as HTMLCanvasElement
    expect(canvas).toBeTruthy()
    expect(canvas.className).toContain('block')
    expect(canvas.className).toContain('max-w-full')
    expect(canvas.width).toBe(240)
    expect(canvas.height).toBe(136)
    expect(worker.posts[0]).toMatchObject({ type: 'render', requestId: 1, resourceContext: 'document-1' })

    state.scene = scene('new')
    state.width = 160
    await nextTick()
    await nextTick()
    expect(worker.posts[1]).toEqual({ type: 'cancel', requestId: 1 })
    expect(worker.posts[2]).toMatchObject({ type: 'render', requestId: 2, viewport: { width: 320, height: 136 } })
    expect(canvas.width).toBe(320)

    worker.emit(result(1, 'stale'))
    expect(events).toEqual([])
    worker.emit(result(2, 'latest'))
    await vi.waitFor(() => expect(events).toEqual([{ drawnNodeIds: ['latest'], skippedNodeIds: [], issues: [] }]))

    app.unmount()
    expect(worker.terminateCalls).toBe(1)
  })
})

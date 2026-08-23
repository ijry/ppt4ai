// @vitest-environment happy-dom
import type { AssetAdapter, AssetMetadata } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ImageCanvas from './ImageCanvas.vue'
import type { DecodedImage, ImageDecoder } from './image-canvas-renderer'

class TestAdapter implements AssetAdapter {
  readonly getCalls: string[] = []

  async get(assetId: string): Promise<Uint8Array | undefined> {
    this.getCalls.push(assetId)
    return new Uint8Array([assetId === 'asset-a' ? 1 : 2])
  }

  async put(_assetId: string, _data: Uint8Array, _metadata: AssetMetadata): Promise<void> {}
}

function scene(...nodes: Array<{ id: string; assetId: string }>): SceneGraph {
  return {
    slideId: 'slide-1',
    page: { w: 9144000, h: 5143500 },
    nodes: nodes.map((node) => ({
      id: node.id,
      kind: 'image' as const,
      bounds: { x: 0, y: 0, w: 1000, h: 1000 },
      assetId: node.assetId,
      metadata: { id: node.assetId, mimeType: 'image/png' as const },
    })),
  }
}

function recordingContext(): CanvasRenderingContext2D & { draws: string[] } {
  const canvas = { width: 0, height: 0, style: { width: '', height: '' } }
  const context = {
    canvas,
    draws: [] as string[],
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    drawImage: vi.fn((source: CanvasImageSource) => {
      context.draws.push((source as unknown as { id: string }).id)
    }),
  }
  return context as unknown as CanvasRenderingContext2D & { draws: string[] }
}

function mountCanvas(initialScene: SceneGraph, adapter: AssetAdapter, decoder: ImageDecoder, renderEvents: unknown[]): { app: App; state: { scene: SceneGraph; zoom: number }; canvas: HTMLCanvasElement } {
  const state = reactive({ scene: initialScene, zoom: 1 })
  const app = createApp({
    setup() {
      return () => h(ImageCanvas, {
        scene: state.scene,
        adapter,
        decoder,
        zoom: state.zoom,
        onRender: (result: unknown) => renderEvents.push(result),
      })
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  app.mount(host)
  return { app, state, canvas: host.querySelector('canvas[data-image-canvas]') as HTMLCanvasElement }
}

describe('ImageCanvas', () => {
  let context: CanvasRenderingContext2D & { draws: string[] }

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('renders one canvas and emits a completed image result', async () => {
    context = recordingContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const renderEvents: unknown[] = []
    const decoder: ImageDecoder = async () => ({ source: { id: 'decoded-a' } as unknown as CanvasImageSource, width: 1, height: 1 })
    const mounted = mountCanvas(scene({ id: 'image-a', assetId: 'asset-a' }), new TestAdapter(), decoder, renderEvents)

    await nextTick()
    await vi.waitFor(() => expect(renderEvents).toHaveLength(1))

    expect(mounted.canvas.className).toContain('block')
    expect(mounted.canvas.className).toContain('max-w-full')
    expect(renderEvents.at(-1)).toEqual({ drawnNodeIds: ['image-a'], skippedNodeIds: [], issues: [] })
    mounted.app.unmount()
  })

  it('suppresses stale renders and reuses decoded assets when zoom changes', async () => {
    context = recordingContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const renderEvents: unknown[] = []
    const pending: Array<(value: DecodedImage) => void> = []
    const decoder: ImageDecoder = () => new Promise((resolve) => pending.push(resolve))
    const adapter = new TestAdapter()
    const mounted = mountCanvas(scene({ id: 'old-image', assetId: 'asset-a' }), adapter, decoder, renderEvents)

    await nextTick()
    mounted.state.scene = scene({ id: 'new-image', assetId: 'asset-b' })
    await nextTick()
    await nextTick()
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    pending[0]?.({ source: { id: 'old' } as unknown as CanvasImageSource, width: 1, height: 1 })
    pending[1]?.({ source: { id: 'new' } as unknown as CanvasImageSource, width: 1, height: 1 })
    await vi.waitFor(() => expect(renderEvents).toHaveLength(1))

    expect(renderEvents.at(-1)).toEqual({ drawnNodeIds: ['new-image'], skippedNodeIds: [], issues: [] })
    const callsBeforeZoom = adapter.getCalls.length
    mounted.state.zoom = 2
    await nextTick()
    await vi.waitFor(() => expect(context.canvas.style.width).toBe('1920px'))
    expect(adapter.getCalls).toHaveLength(callsBeforeZoom)
    mounted.app.unmount()
  })

  it('closes decoded resources exactly once on unmount', async () => {
    context = recordingContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const close = vi.fn()
    const renderEvents: unknown[] = []
    const decoder: ImageDecoder = async () => ({ source: {} as CanvasImageSource, width: 1, height: 1, close })
    const mounted = mountCanvas(scene({ id: 'image-a', assetId: 'asset-a' }), new TestAdapter(), decoder, renderEvents)

    await vi.waitFor(() => expect(renderEvents).toHaveLength(1))
    mounted.app.unmount()

    expect(close).toHaveBeenCalledOnce()
  })
})

// @vitest-environment happy-dom
import type { AssetAdapter } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import { createApp, h, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SlideCanvas from './SlideCanvas.vue'
import type { NodePaintOverride } from './slide-canvas-renderer'

const adapter: AssetAdapter = { get: async () => undefined, put: async () => {} }

type Event = [string, ...unknown[]]

function recordingContext(): CanvasRenderingContext2D & { events: Event[] } {
  const events: Event[] = []
  const canvas = { width: 0, height: 0, style: { width: '', height: '' } }
  const context = {
    canvas,
    events,
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    filter: 'none',
    save: () => {}, restore: () => {}, beginPath: () => {}, closePath: () => {},
    moveTo: () => {}, lineTo: () => {}, ellipse: () => {}, rect: () => {}, roundRect: () => {},
    clip: () => {}, translate: () => {}, rotate: () => {}, scale: () => {},
    setLineDash: () => {}, clearRect: () => {}, fillRect: () => {}, setTransform: () => {},
    fillText: () => {}, drawImage: () => {}, stroke: () => {},
    fill(): void { events.push(['fill', this.fillStyle, this.globalAlpha]) },
  }
  return context as unknown as CanvasRenderingContext2D & { events: Event[] }
}

function scene(): SceneGraph {
  return {
    slideId: 'slide-1',
    page: { w: 9144000, h: 5143500 },
    nodes: [{
      id: 'shape-1',
      kind: 'shape',
      bounds: { x: 0, y: 0, w: 400, h: 200 },
      path: [{ type: 'move', x: 0, y: 0 }, { type: 'line', x: 400, y: 0 }, { type: 'close' }],
      resolvedFillColor: { rgb: '336699', alpha: 100000 },
    }],
  }
}

function mount(overrides: ReadonlyMap<string, NodePaintOverride>, renderEvents: unknown[]): App {
  const app = createApp({
    setup() {
      return () => h(SlideCanvas, { scene: scene(), adapter, zoom: 1, overrides, onRender: (r: unknown) => renderEvents.push(r) })
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  app.mount(host)
  return app
}

describe('SlideCanvas animation overrides', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('dims a node by the override opacity when rendering', async () => {
    const context = recordingContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const renderEvents: unknown[] = []
    const app = mount(new Map([['shape-1', { opacity: 0.5 }]]), renderEvents)
    await nextTick()
    await vi.waitFor(() => expect(renderEvents).toHaveLength(1))
    expect(context.events).toContainEqual(['fill', '#336699', 0.5])
    app.unmount()
  })

  it('paints fully opaque without overrides', async () => {
    const context = recordingContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const renderEvents: unknown[] = []
    const app = mount(new Map(), renderEvents)
    await vi.waitFor(() => expect(renderEvents).toHaveLength(1))
    expect(context.events).toContainEqual(['fill', '#336699', 1])
    app.unmount()
  })
})

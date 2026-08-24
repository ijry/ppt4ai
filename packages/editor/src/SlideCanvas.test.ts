// @vitest-environment happy-dom
import type { AssetAdapter } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import { createApp, h, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SlideCanvas from './SlideCanvas.vue'
import type { DecodedImage } from './image-canvas-renderer'

const adapter: AssetAdapter = { get: async () => undefined, put: async () => {} }

function scene(): SceneGraph {
  return {
    slideId: 'slide-1',
    page: { w: 9144000, h: 5143500 },
    nodes: [{
      id: 'shape-1',
      kind: 'shape',
      bounds: { x: 0, y: 0, w: 50000, h: 50000 },
      path: [],
    }],
  }
}

function context(): CanvasRenderingContext2D {
  const canvas = { width: 0, height: 0, style: { width: '', height: '' } }
  return {
    canvas,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

function mount(renderEvents: unknown[], selectEvents: unknown[], moveEvents: unknown[] = [], activateEvents: unknown[] = [], sceneValue: SceneGraph = scene(), groupPath: string[] = [], enterGroupEvents: unknown[] = []): { app: App; canvas: HTMLCanvasElement } {
  const app = createApp({
    setup() {
      return () => h(SlideCanvas, {
        scene: sceneValue,
        adapter,
        decoder: async (): Promise<DecodedImage> => ({ source: {} as CanvasImageSource, width: 1, height: 1 }),
        zoom: 1,
        groupPath,
        onRender: (result: unknown) => renderEvents.push(result),
        onSelect: (id: unknown) => selectEvents.push(id),
        onMoveStart: (payload: unknown) => moveEvents.push({ type: 'start', payload }),
        onMove: (payload: unknown) => moveEvents.push({ type: 'move', payload }),
        onMoveEnd: (payload: unknown) => moveEvents.push({ type: 'end', payload }),
        onActivate: (id: unknown) => activateEvents.push(id),
        onEnterGroup: (id: unknown) => enterGroupEvents.push(id),
      })
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  app.mount(host)
  return { app, canvas: host.querySelector('canvas[data-slide-canvas]') as HTMLCanvasElement }
}

describe('SlideCanvas', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('renders a canvas and emits render and topmost selection events', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context())
    const renderEvents: unknown[] = []
    const selectEvents: unknown[] = []
    const mounted = mount(renderEvents, selectEvents)

    await nextTick()
    await vi.waitFor(() => expect(renderEvents).toHaveLength(1))
    vi.spyOn(mounted.canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 960, height: 540 } as DOMRect)
    mounted.canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1, clientY: 1, bubbles: true }))

    expect(mounted.canvas.dataset.slideCanvas).toBe('')
    expect(renderEvents[0]).toMatchObject({ drawnNodeIds: ['shape-1'], cssWidth: 960, cssHeight: 540 })
    expect(selectEvents).toEqual([{ nodeId: 'shape-1', toggle: false }])
    mounted.app.unmount()
  })

  it('reports modifier clicks as toggle selection intents', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context())
    const renderEvents: unknown[] = []
    const selectEvents: unknown[] = []
    const mounted = mount(renderEvents, selectEvents)

    await vi.waitFor(() => expect(renderEvents).toHaveLength(1))
    vi.spyOn(mounted.canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 960, height: 540 } as DOMRect)
    mounted.canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1, clientY: 1, shiftKey: true, bubbles: true }))
    mounted.canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1, clientY: 1, ctrlKey: true, bubbles: true }))
    mounted.canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1, clientY: 1, metaKey: true, bubbles: true }))
    mounted.canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 900, clientY: 500, bubbles: true }))

    expect(selectEvents).toEqual([
      { nodeId: 'shape-1', toggle: true },
      { nodeId: 'shape-1', toggle: true },
      { nodeId: 'shape-1', toggle: true },
      { nodeId: undefined, toggle: false },
    ])
    mounted.app.unmount()
  })

  it('captures a pointer drag and emits EMU move deltas', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context())
    const renderEvents: unknown[] = []
    const selectEvents: unknown[] = []
    const moveEvents: unknown[] = []
    const mounted = mount(renderEvents, selectEvents, moveEvents)

    await vi.waitFor(() => expect(renderEvents).toHaveLength(1))
    vi.spyOn(mounted.canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 960, height: 540 } as DOMRect)
    const setPointerCapture = vi.fn()
    Object.defineProperty(mounted.canvas, 'setPointerCapture', { configurable: true, value: setPointerCapture })
    mounted.canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1, clientY: 1, pointerId: 7, bubbles: true }))
    mounted.canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 11, clientY: 21, pointerId: 7, bubbles: true }))
    mounted.canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 11, clientY: 21, pointerId: 7, bubbles: true }))

    expect(setPointerCapture).toHaveBeenCalledWith(7)
    expect(moveEvents).toEqual([
      { type: 'start', payload: { nodeId: 'shape-1', point: { x: 9525, y: 9525 } } },
      { type: 'move', payload: { nodeId: 'shape-1', dx: 95250, dy: 190500 } },
      { type: 'end', payload: { nodeId: 'shape-1', dx: 95250, dy: 190500 } },
    ])
    mounted.app.unmount()
  })

  it('activates the hit node on double click', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context())
    const renderEvents: unknown[] = []
    const selectEvents: unknown[] = []
    const activateEvents: unknown[] = []
    const mounted = mount(renderEvents, selectEvents, [], activateEvents)

    await vi.waitFor(() => expect(renderEvents).toHaveLength(1))
    vi.spyOn(mounted.canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 960, height: 540 } as DOMRect)
    mounted.canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 1, clientY: 1, bubbles: true }))

    expect(activateEvents).toEqual(['shape-1'])
    mounted.app.unmount()
  })

  it('emits the top-level group id for grouped pointer gestures', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context())
    const renderEvents: unknown[] = []
    const selectEvents: unknown[] = []
    const moveEvents: unknown[] = []
    const mounted = mount(renderEvents, selectEvents, moveEvents, [], {
      ...scene(),
      nodes: [{ id: 'group-leaf', kind: 'shape', bounds: { x: 0, y: 0, w: 50000, h: 50000 }, path: [] }],
      groups: [{ id: 'group-1', bounds: { x: 0, y: 0, w: 50000, h: 50000 }, childIds: ['group-leaf'], ancestorIds: [], paintOrder: 0 }],
    })

    await vi.waitFor(() => expect(renderEvents).toHaveLength(1))
    vi.spyOn(mounted.canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 960, height: 540 } as DOMRect)
    mounted.canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1, clientY: 1, pointerId: 12, bubbles: true }))
    mounted.canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 1, clientY: 1, pointerId: 12, bubbles: true }))

    expect(selectEvents).toEqual([{ nodeId: 'group-1', toggle: false }])
    expect(moveEvents[0]).toEqual({ type: 'start', payload: { nodeId: 'group-1', point: { x: 9525, y: 9525 } } })
    expect(moveEvents[1]).toEqual({ type: 'end', payload: { nodeId: 'group-1', dx: 0, dy: 0 } })
    mounted.app.unmount()
  })

  it('uses the active group path for pointer selection and group entry', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context())
    const renderEvents: unknown[] = []
    const selectEvents: unknown[] = []
    const activateEvents: unknown[] = []
    const enterGroupEvents: unknown[] = []
    const mounted = mount(renderEvents, selectEvents, [], activateEvents, {
      ...scene(),
      nodes: [
        { id: 'outer-leaf', kind: 'shape', bounds: { x: 0, y: 0, w: 50000, h: 50000 }, path: [] },
        { id: 'inner-leaf', kind: 'shape', bounds: { x: 100000, y: 0, w: 50000, h: 50000 }, path: [] },
      ],
      groups: [
        { id: 'outer', bounds: { x: 0, y: 0, w: 2000000, h: 50000 }, childIds: ['outer-leaf', 'inner'], ancestorIds: [], paintOrder: 1 },
        { id: 'inner', bounds: { x: 900000, y: 0, w: 1000000, h: 50000 }, childIds: ['inner-leaf'], ancestorIds: ['outer'], paintOrder: 1 },
      ],
    }, ['outer'], enterGroupEvents)

    await vi.waitFor(() => expect(renderEvents).toHaveLength(1))
    vi.spyOn(mounted.canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 960, height: 540 } as DOMRect)
    mounted.canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1, clientY: 1, pointerId: 20, bubbles: true }))
    mounted.canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 97, clientY: 1, bubbles: true }))

    expect(selectEvents).toEqual([{ nodeId: 'outer-leaf', toggle: false }])
    expect(activateEvents).toEqual([])
    expect(enterGroupEvents).toEqual(['inner'])
    mounted.app.unmount()
  })

  it('cancels a pointer drag without committing move-end', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context())
    const renderEvents: unknown[] = []
    const selectEvents: unknown[] = []
    const moveEvents: unknown[] = []
    const mounted = mount(renderEvents, selectEvents, moveEvents)

    await vi.waitFor(() => expect(renderEvents).toHaveLength(1))
    vi.spyOn(mounted.canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 960, height: 540 } as DOMRect)
    const releasePointerCapture = vi.fn()
    Object.defineProperty(mounted.canvas, 'releasePointerCapture', { configurable: true, value: releasePointerCapture })
    mounted.canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1, clientY: 1, pointerId: 8, bubbles: true }))
    mounted.canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 11, clientY: 21, pointerId: 8, bubbles: true }))
    mounted.canvas.dispatchEvent(new PointerEvent('pointercancel', { clientX: 11, clientY: 21, pointerId: 8, bubbles: true }))

    expect(moveEvents).toEqual([
      { type: 'start', payload: { nodeId: 'shape-1', point: { x: 9525, y: 9525 } } },
      { type: 'move', payload: { nodeId: 'shape-1', dx: 95250, dy: 190500 } },
    ])
    expect(releasePointerCapture).toHaveBeenCalledWith(8)
    mounted.app.unmount()
  })
})

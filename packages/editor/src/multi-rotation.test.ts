// @vitest-environment happy-dom
import type { SceneGraph } from '@ppt4ai/render'
import { createApp, h, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import PptEditor from './PptEditor.vue'
import { createPpt4aiI18n } from './i18n'
import { rotationFromPointer } from './image-transform'

const adapter = { get: async () => undefined, put: async () => {} }

const pairScene: SceneGraph = {
  slideId: 'slide-1',
  page: { w: 9144000, h: 5143500 },
  nodes: [
    { id: 'shape-1', kind: 'shape', bounds: { x: 914400, y: 914400, w: 914400, h: 914400 }, path: [] },
    { id: 'shape-2', kind: 'shape', bounds: { x: 1828800, y: 914400, w: 914400, h: 914400 }, path: [] },
  ],
} as unknown as SceneGraph

function mount(props: Record<string, unknown>) {
  const app = createApp({
    setup: () => () => h(PptEditor, { scene: pairScene, adapter, ...props }),
  })
  app.use(createPpt4aiI18n())
  const host = document.createElement('div')
  document.body.append(host)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    canvas: { width: 0, height: 0, style: { width: '', height: '' } },
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  app.mount(host)
  return { app, host }
}

describe('multi-selection rotation gesture', () => {
  it('shows the rotation handle for a multi-selection', async () => {
    const { app, host } = mount({ selectedElementIds: ['shape-1', 'shape-2'] })
    await nextTick()

    expect(host.querySelectorAll('[data-selection-rotation-handle]')).toHaveLength(1)

    app.unmount()
    host.remove()
  })

  it('emits rotate-selection on pointerup rather than a per-element event', async () => {
    const selectionEvents: Array<{ rotation: number }> = []
    const elementEvents: unknown[] = []
    const { app, host } = mount({
      selectedElementIds: ['shape-1', 'shape-2'],
      onRotateSelection: (payload: { rotation: number }) => selectionEvents.push(payload),
      onRotateElement: (payload: unknown) => elementEvents.push(payload),
    })
    await nextTick()
    const canvasHost = host.querySelector('.ppt-editor__canvas') as HTMLElement
    vi.spyOn(canvasHost, 'getBoundingClientRect').mockReturnValue({ left: 40, top: 30, width: 960, height: 540 } as DOMRect)
    const handle = host.querySelector('[data-selection-rotation-handle]') as HTMLButtonElement

    // Union spans 914400..2743200 x 914400..1828800 EMU, whose centre is (192, 144) in overlay
    // space. Pointer coords are client-space, so shift by the mocked canvas origin (40, 30).
    const centre = { x: 192, y: 144 }
    const startPoint = { x: 232, y: 100 }
    const currentPoint = { x: 290, y: 174 }

    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: startPoint.x, clientY: startPoint.y, pointerId: 71, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: currentPoint.x, clientY: currentPoint.y, pointerId: 71, bubbles: true }))

    expect(elementEvents).toEqual([])
    expect(selectionEvents).toHaveLength(1)
    expect(selectionEvents[0]!.rotation).toBe(rotationFromPointer(
      0,
      centre,
      { x: startPoint.x - 40, y: startPoint.y - 30 },
      { x: currentPoint.x - 40, y: currentPoint.y - 30 },
    ))

    app.unmount()
    host.remove()
  })

  it('still emits the per-element event for a single selection', async () => {
    const selectionEvents: unknown[] = []
    const elementEvents: Array<{ elementId: string }> = []
    const { app, host } = mount({
      selectedElementId: 'shape-1',
      onRotateSelection: (payload: unknown) => selectionEvents.push(payload),
      onRotateElement: (payload: { elementId: string }) => elementEvents.push(payload),
    })
    await nextTick()
    const canvasHost = host.querySelector('.ppt-editor__canvas') as HTMLElement
    vi.spyOn(canvasHost, 'getBoundingClientRect').mockReturnValue({ left: 40, top: 30, width: 960, height: 540 } as DOMRect)
    const handle = host.querySelector('[data-selection-rotation-handle]') as HTMLButtonElement

    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 136, clientY: 80, pointerId: 72, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 190, clientY: 126, pointerId: 72, bubbles: true }))

    expect(selectionEvents).toEqual([])
    expect(elementEvents).toEqual([{ elementId: 'shape-1', rotation: expect.any(Number) }])

    app.unmount()
    host.remove()
  })

  it('previews the union rotation while dragging a multi-selection', async () => {
    const { app, host } = mount({ selectedElementIds: ['shape-1', 'shape-2'] })
    await nextTick()
    const canvasHost = host.querySelector('.ppt-editor__canvas') as HTMLElement
    vi.spyOn(canvasHost, 'getBoundingClientRect').mockReturnValue({ left: 40, top: 30, width: 960, height: 540 } as DOMRect)
    const handle = host.querySelector('[data-selection-rotation-handle]') as HTMLButtonElement

    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 136, clientY: 80, pointerId: 73, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 190, clientY: 126, pointerId: 73, bubbles: true }))
    await nextTick()

    const frame = host.querySelector('[data-selection-frame]') as HTMLElement
    expect(frame.style.transform).not.toBe('rotate(0deg)')

    handle.dispatchEvent(new PointerEvent('pointercancel', { clientX: 190, clientY: 126, pointerId: 73, bubbles: true }))
    app.unmount()
    host.remove()
  })
})

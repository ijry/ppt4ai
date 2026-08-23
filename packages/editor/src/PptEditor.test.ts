// @vitest-environment happy-dom
import type { AssetAdapter, TextBody } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import type { ImeInputBridge, ImeInputBridgeOptions } from '@ppt4ai/text'
import { createApp, h, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPpt4aiI18n, locales } from './i18n'
import PptEditor from './PptEditor.vue'
import type { DecodedImage, ImageDecoder } from './image-canvas-renderer'

const adapter: AssetAdapter = { get: async () => undefined, put: async () => {} }
const scene: SceneGraph = {
  slideId: 'slide-1',
  page: { w: 9144000, h: 5143500 },
  nodes: [{ id: 'shape-1', kind: 'shape', bounds: { x: 914400, y: 914400, w: 1828800, h: 914400 }, path: [] }],
}

const groupedScene: SceneGraph = {
  slideId: 'slide-1',
  page: { w: 9144000, h: 5143500 },
  nodes: [{ id: 'group-leaf', kind: 'shape', bounds: { x: 914400, y: 914400, w: 1828800, h: 914400 }, path: [] }],
  groups: [{ id: 'group-1', bounds: { x: 914400, y: 914400, w: 3657600, h: 1828800 }, childIds: ['group-leaf'], ancestorIds: [], paintOrder: 0 }],
}

const textBody: TextBody = { paragraphs: [{ runs: [{ text: 'Editable' }] }] }
const textScene: SceneGraph = {
  slideId: 'slide-1',
  page: { w: 9144000, h: 5143500 },
  nodes: [
    { id: 'shape-1', kind: 'shape', bounds: { x: 914400, y: 914400, w: 1828800, h: 914400 }, path: [] },
    { id: 'text-1', kind: 'text', bounds: { x: 3657600, y: 914400, w: 1828800, h: 914400 }, text: 'Editable', layout: { bounds: { x: 3657600, y: 914400, w: 1828800, h: 914400 }, lines: [], fontScale: 100000, overflow: false, contentBounds: { x: 3657600, y: 914400, w: 0, h: 0 } } },
  ],
}

interface BridgeHarness {
  options?: ImeInputBridgeOptions
}

function createBridgeFactory(harness: BridgeHarness) {
  return (options: ImeInputBridgeOptions): ImeInputBridge => {
    harness.options = options
    return {
      focus: () => {},
      setCaretRect: () => {},
      getCaretClientRect: () => new DOMRect(),
      destroy: () => {},
    }
  }
}

function mount(selectedElementId: string | undefined): { app: App; host: HTMLElement } {
  const app = createApp({
    setup() {
      return () => h(PptEditor, {
        scene,
        adapter,
        ...(selectedElementId ? { selectedElementId } : {}),
        decoder: async (): Promise<DecodedImage> => ({ source: {} as CanvasImageSource, width: 1, height: 1 }),
      })
    },
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

describe('PptEditor', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('renders the controlled slide canvas and eight handles for an existing selection', async () => {
    const mounted = mount('shape-1')
    await nextTick()

    expect(mounted.host.querySelector('[data-slide-canvas]')).toBeTruthy()
    expect(mounted.host.querySelector('[data-selection-overlay]')).toBeTruthy()
    expect(mounted.host.querySelectorAll('[data-selection-handle]')).toHaveLength(8)
    expect(mounted.host.querySelector('[data-selection-border]')?.getAttribute('style')).toContain('left: 96px')
    mounted.app.unmount()
  })

  it('does not render a selection overlay for an unknown or empty selection', async () => {
    const mounted = mount('missing')
    await nextTick()
    expect(mounted.host.querySelector('[data-selection-overlay]')).toBeNull()
    mounted.app.unmount()
  })

  it('renders group bounds with the existing border and eight resize handles', async () => {
    const app = createApp({
      setup() {
        return () => h(PptEditor, { scene: groupedScene, adapter, selectedElementId: 'group-1' })
      },
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
    await nextTick()

    expect(host.querySelector('[data-selection-border]')?.getAttribute('style')).toContain('left: 96px')
    expect(host.querySelector('[data-selection-border]')?.getAttribute('style')).toContain('width: 384px')
    expect(host.querySelectorAll('[data-selection-handle]')).toHaveLength(8)
    app.unmount()
  })

  it('does not enter text editing when a group is double-clicked', async () => {
    const groupTextScene: SceneGraph = {
      ...groupedScene,
      nodes: [{ id: 'group-text', kind: 'text', bounds: { x: 914400, y: 914400, w: 1828800, h: 914400 }, text: 'Grouped', layout: { bounds: { x: 914400, y: 914400, w: 1828800, h: 914400 }, lines: [], fontScale: 100000, overflow: false, contentBounds: { x: 914400, y: 914400, w: 0, h: 0 } } }],
      groups: [{ id: 'group-1', bounds: { x: 914400, y: 914400, w: 3657600, h: 1828800 }, childIds: ['group-text'], ancestorIds: [], paintOrder: 0 }],
    }
    const app = createApp({
      setup() {
        return () => h(PptEditor, { scene: groupTextScene, adapter, textBodies: { 'group-text': textBody } })
      },
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
    await nextTick()
    const canvas = host.querySelector('[data-slide-canvas]') as HTMLCanvasElement
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 960, height: 540 } as DOMRect)
    canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 97, clientY: 97, bubbles: true }))
    await nextTick()

    expect(host.querySelector('[data-text-box-editor]')).toBeNull()
    app.unmount()
  })

  it('edits a text node in place and commits one clone-safe session body', async () => {
    const harness: BridgeHarness = {}
    const textEditEvents: unknown[] = []
    const app = createApp({
      setup: () => () => h(PptEditor, {
        scene: textScene,
        adapter,
        selectedElementId: 'text-1',
        textBodies: { 'text-1': textBody },
        bridgeFactory: createBridgeFactory(harness),
        onTextEdit: (payload: unknown) => textEditEvents.push(payload),
      }),
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
    await nextTick()

    const canvas = host.querySelector('[data-slide-canvas]') as HTMLCanvasElement
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 960, height: 540 } as DOMRect)
    canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 385, clientY: 97, bubbles: true }))
    await nextTick()

    expect(host.querySelector('[data-text-box-editor]')).not.toBeNull()
    expect(host.querySelector('[data-text-caret]')).not.toBeNull()
    expect(host.querySelector('[data-selection-border]')).not.toBeNull()
    expect(host.querySelectorAll('[data-selection-handle]')).toHaveLength(8)

    harness.options?.onEvent({ type: 'text-input', text: 'A' })
    await nextTick()
    const editor = host.querySelector('[data-text-element-editor]') as HTMLElement
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }))
    await nextTick()

    expect(textEditEvents).toEqual([{ elementId: 'text-1', body: { paragraphs: [{ runs: [{ text: 'AEditable' }] }] } }])
    expect(structuredClone(textEditEvents[0])).toEqual(textEditEvents[0])
    expect(host.querySelector('[data-text-box-editor]')).toBeNull()

    canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 385, clientY: 97, bubbles: true }))
    await nextTick()
    const reopened = host.querySelector('[data-text-element-editor]') as HTMLElement
    reopened.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await nextTick()

    expect(textEditEvents).toHaveLength(1)
    expect(host.querySelector('[data-text-box-editor]')).toBeNull()
    app.unmount()
  })

  it('does not enter text editing when a shape is activated', async () => {
    const app = createApp({
      setup: () => () => h(PptEditor, {
        scene: textScene,
        adapter,
        selectedElementId: 'shape-1',
        textBodies: { 'text-1': textBody },
      }),
    })
    app.use(createPpt4aiI18n())
    const host = document.createElement('div')
    document.body.append(host)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      canvas: { width: 0, height: 0, style: { width: '', height: '' } },
      clearRect: vi.fn(), setTransform: vi.fn(), save: vi.fn(), restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    app.mount(host)
    await nextTick()
    const canvas = host.querySelector('[data-slide-canvas]') as HTMLCanvasElement
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 960, height: 540 } as DOMRect)

    canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 97, clientY: 97, bubbles: true }))
    await nextTick()

    expect(host.querySelector('[data-text-box-editor]')).toBeNull()
    app.unmount()
  })

  it('emits one resize intent after a selected handle drag', async () => {
    const resizeEvents: unknown[] = []
    const app = createApp({
      setup() {
        return () => h(PptEditor, {
          scene,
          adapter,
          selectedElementId: 'shape-1',
          onResize: (payload: unknown) => resizeEvents.push(payload),
        })
      },
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
    await nextTick()

    const handle = host.querySelector('[data-selection-handle="se"]') as HTMLButtonElement
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 288, clientY: 192, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 384, clientY: 288, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 384, clientY: 288, bubbles: true }))

    expect(resizeEvents).toEqual([{ elementId: 'shape-1', bounds: { x: 914400, y: 914400, w: 2743200, h: 1828800 } }])
    app.unmount()
  })

  it('does not preview or commit a resize without an active handle gesture', async () => {
    const resizeEvents: unknown[] = []
    const app = createApp({
      setup() {
        return () => h(PptEditor, {
          scene,
          adapter,
          selectedElementId: 'shape-1',
          onResize: (payload: unknown) => resizeEvents.push(payload),
        })
      },
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
    await nextTick()

    const handle = host.querySelector('[data-selection-handle="se"]') as HTMLButtonElement
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 384, clientY: 288, pointerId: 9, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 384, clientY: 288, pointerId: 9, bubbles: true }))

    expect(resizeEvents).toEqual([])
    expect(host.querySelector('[data-selection-border]')?.getAttribute('style')).toContain('width: 192px')
    app.unmount()
  })

  it('cancels a resize gesture without retaining its preview', async () => {
    const resizeEvents: unknown[] = []
    const app = createApp({
      setup() {
        return () => h(PptEditor, {
          scene,
          adapter,
          selectedElementId: 'shape-1',
          onResize: (payload: unknown) => resizeEvents.push(payload),
        })
      },
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
    await nextTick()

    const handle = host.querySelector('[data-selection-handle="se"]') as HTMLButtonElement
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 288, clientY: 192, pointerId: 10, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 384, clientY: 288, pointerId: 10, bubbles: true }))
    await nextTick()
    expect(host.querySelector('[data-selection-border]')?.getAttribute('style')).toContain('width: 288px')

    handle.dispatchEvent(new PointerEvent('pointercancel', { clientX: 384, clientY: 288, pointerId: 10, bubbles: true }))
    await nextTick()

    expect(resizeEvents).toEqual([])
    expect(host.querySelector('[data-selection-border]')?.getAttribute('style')).toContain('width: 192px')
    app.unmount()
  })

  it('keeps localized editor keys symmetric', () => {
    const flatten = (value: Record<string, unknown>, prefix = ''): string[] => Object.entries(value).flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key
      return typeof child === 'string' ? [path] : flatten(child as Record<string, unknown>, path)
    })
    expect(flatten(locales['zh-CN'])).toEqual(flatten(locales['en-US']))
  })
})

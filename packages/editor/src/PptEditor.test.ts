// @vitest-environment happy-dom
import type { AssetAdapter, TextBody } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import type { ImeInputBridge, ImeInputBridgeOptions } from '@ppt4ai/text'
import { createApp, h, nextTick, ref, type App } from 'vue'
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

const multiSelectionScene: SceneGraph = {
  slideId: 'slide-1',
  page: { w: 9144000, h: 5143500 },
  nodes: [
    { id: 'shape-1', kind: 'shape', bounds: { x: 0, y: 0, w: 914400, h: 914400 }, path: [] },
    { id: 'shape-2', kind: 'shape', bounds: { x: 914400, y: 0, w: 914400, h: 914400 }, path: [] },
    { id: 'group-leaf', kind: 'shape', bounds: { x: 1828800, y: 914400, w: 914400, h: 914400 }, path: [] },
  ],
  groups: [{ id: 'group-1', bounds: { x: 1828800, y: 914400, w: 914400, h: 914400 }, childIds: ['group-leaf'], ancestorIds: [], paintOrder: 2 }],
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

function mountEditor(editorProps: Record<string, unknown>, locale: keyof typeof locales = 'zh-CN'): { app: App; host: HTMLElement } {
  const app = createApp({
    setup() {
      return () => h(PptEditor, {
        scene,
        adapter,
        decoder: async (): Promise<DecodedImage> => ({ source: {} as CanvasImageSource, width: 1, height: 1 }),
        ...editorProps,
      })
    },
  })
  app.use(createPpt4aiI18n(locale))
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

function mount(selectedElementId: string | undefined): { app: App; host: HTMLElement } {
  return mountEditor(selectedElementId ? { selectedElementId } : {})
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

  it('uses controlled multi-selection precedence and renders one union border without resize handles', async () => {
    const mounted = mountEditor({
      scene: multiSelectionScene,
      selectedElementId: 'shape-2',
      selectedElementIds: ['shape-1', 'group-1'],
    })
    await nextTick()

    const style = mounted.host.querySelector('[data-selection-border]')?.getAttribute('style')
    expect(style).toContain('left: 0px')
    expect(style).toContain('top: 0px')
    expect(style).toContain('width: 288px')
    expect(style).toContain('height: 192px')
    expect(mounted.host.querySelectorAll('[data-selection-handle]')).toHaveLength(8)
    mounted.app.unmount()
  })

  it('normalizes controlled IDs and emits selection changes before the legacy single-selection event', async () => {
    const events: unknown[] = []
    const mounted = mountEditor({
      scene: multiSelectionScene,
      selectedElementIds: ['shape-1', 'missing', 'shape-1'],
      onSelectionChange: (payload: unknown) => events.push({ type: 'selection-change', payload }),
      onSelect: (nodeId: unknown) => events.push({ type: 'select', payload: nodeId }),
    })
    await nextTick()
    const canvas = mounted.host.querySelector('[data-slide-canvas]') as HTMLCanvasElement
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 960, height: 540 } as DOMRect)

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 97, clientY: 1, shiftKey: true, bubbles: true }))

    expect(events).toEqual([
      { type: 'selection-change', payload: { elementIds: ['shape-1', 'shape-2'] } },
      { type: 'select', payload: undefined },
    ])
    mounted.app.unmount()
  })

  it('clears selection on a normal blank click and ignores a modified blank click', async () => {
    const events: unknown[] = []
    const mounted = mountEditor({
      scene: multiSelectionScene,
      selectedElementIds: ['shape-1', 'shape-2'],
      onSelectionChange: (payload: unknown) => events.push({ type: 'selection-change', payload }),
      onSelect: (nodeId: unknown) => events.push({ type: 'select', payload: nodeId }),
    })
    await nextTick()
    const canvas = mounted.host.querySelector('[data-slide-canvas]') as HTMLCanvasElement
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 960, height: 540 } as DOMRect)

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 900, clientY: 500, ctrlKey: true, bubbles: true }))
    expect(events).toEqual([])

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 900, clientY: 500, bubbles: true }))
    expect(events).toEqual([
      { type: 'selection-change', payload: { elementIds: [] } },
      { type: 'select', payload: undefined },
    ])
    mounted.app.unmount()
  })

  it('preserves a controlled multi-selection while dragging an already selected member', async () => {
    const events: unknown[] = []
    const mounted = mountEditor({
      scene: multiSelectionScene,
      selectedElementIds: ['shape-1', 'shape-2'],
      onSelectionChange: (payload: unknown) => events.push({ type: 'selection-change', payload }),
      onSelect: (nodeId: unknown) => events.push({ type: 'select', payload: nodeId }),
    })
    await nextTick()
    const canvas = mounted.host.querySelector('[data-slide-canvas]') as HTMLCanvasElement
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 960, height: 540 } as DOMRect)

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1, clientY: 1, pointerId: 7, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 21, clientY: 21, pointerId: 7, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 21, clientY: 21, pointerId: 7, bubbles: true }))

    expect(events).toEqual([])
    mounted.app.unmount()
  })

  it('replaces a controlled multi-selection after clicking an already selected member without dragging', async () => {
    const events: unknown[] = []
    const mounted = mountEditor({
      scene: multiSelectionScene,
      selectedElementIds: ['shape-1', 'shape-2'],
      onSelectionChange: (payload: unknown) => events.push({ type: 'selection-change', payload }),
      onSelect: (nodeId: unknown) => events.push({ type: 'select', payload: nodeId }),
    })
    await nextTick()
    const canvas = mounted.host.querySelector('[data-slide-canvas]') as HTMLCanvasElement
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 960, height: 540 } as DOMRect)

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1, clientY: 1, pointerId: 8, bubbles: true }))
    expect(events).toEqual([])
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 1, clientY: 1, pointerId: 8, bubbles: true }))

    expect(events).toEqual([
      { type: 'selection-change', payload: { elementIds: ['shape-1'] } },
      { type: 'select', payload: 'shape-1' },
    ])
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

  it('enables group and ungroup only for valid top-level selections', async () => {
    const cases = [
      { selectedElementIds: [], groupDisabled: true, ungroupDisabled: true },
      { selectedElementIds: ['shape-1'], groupDisabled: true, ungroupDisabled: true },
      { selectedElementIds: ['shape-1', 'shape-2'], groupDisabled: false, ungroupDisabled: true },
      { selectedElementIds: ['group-1'], groupDisabled: true, ungroupDisabled: false },
      { selectedElementIds: ['group-1', 'shape-1'], groupDisabled: false, ungroupDisabled: true },
    ]

    for (const entry of cases) {
      const mounted = mountEditor({ scene: multiSelectionScene, selectedElementIds: entry.selectedElementIds })
      await nextTick()
      const groupButton = mounted.host.querySelector('[data-group-button]') as HTMLButtonElement
      const ungroupButton = mounted.host.querySelector('[data-ungroup-button]') as HTMLButtonElement
      expect(groupButton.type).toBe('button')
      expect(ungroupButton.type).toBe('button')
      expect(groupButton.disabled).toBe(entry.groupDisabled)
      expect(ungroupButton.disabled).toBe(entry.ungroupDisabled)
      mounted.app.unmount()
      mounted.host.remove()
    }
  })

  it('localizes native group controls and emits only enabled commands', async () => {
    const groupEvents: unknown[] = []
    const disabledUngroupEvents: unknown[] = []
    const grouped = mountEditor({
      scene: multiSelectionScene,
      selectedElementIds: ['shape-1', 'shape-2'],
      onGroup: () => groupEvents.push('group'),
      onUngroup: (payload: unknown) => disabledUngroupEvents.push(payload),
    }, 'en-US')
    await nextTick()
    const groupButton = grouped.host.querySelector('[data-group-button]') as HTMLButtonElement
    const disabledUngroupButton = grouped.host.querySelector('[data-ungroup-button]') as HTMLButtonElement

    expect(groupButton.textContent?.trim()).toBe('Group')
    expect(groupButton.getAttribute('aria-label')).toBe('Group')
    expect(groupButton.className).toContain('focus-visible:')
    expect(groupButton.className).toContain('duration-150')
    groupButton.click()
    disabledUngroupButton.click()
    expect(groupEvents).toEqual(['group'])
    expect(disabledUngroupEvents).toEqual([])
    grouped.app.unmount()
    grouped.host.remove()

    const ungroupEvents: unknown[] = []
    const ungrouped = mountEditor({
      scene: multiSelectionScene,
      selectedElementIds: ['group-1'],
      onUngroup: (payload: unknown) => ungroupEvents.push(payload),
    })
    await nextTick()
    const ungroupButton = ungrouped.host.querySelector('[data-ungroup-button]') as HTMLButtonElement
    expect(ungroupButton.textContent?.trim()).toBe('取消组合')
    expect(ungroupButton.getAttribute('aria-label')).toBe('取消组合')
    ungroupButton.click()
    expect(ungroupEvents).toEqual([{ groupId: 'group-1' }])
    ungrouped.app.unmount()
  })

  it('keeps group commands disabled while editing inside a group', async () => {
    const mounted = mountEditor({
      scene: multiSelectionScene,
      selectedElementIds: ['shape-1', 'shape-2'],
    })
    await nextTick()
    const canvas = mounted.host.querySelector('[data-slide-canvas]') as HTMLCanvasElement
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 960, height: 540 } as DOMRect)
    canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 193, clientY: 97, bubbles: true }))
    await nextTick()

    expect((mounted.host.querySelector('[data-group-button]') as HTMLButtonElement).disabled).toBe(true)
    expect((mounted.host.querySelector('[data-ungroup-button]') as HTMLButtonElement).disabled).toBe(true)
    mounted.app.unmount()
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

  it('enters a group on double-click and exits one level on Escape', async () => {
    const nestedScene: SceneGraph = {
      ...groupedScene,
      nodes: [
        { id: 'outer-leaf', kind: 'shape', bounds: { x: 914400, y: 914400, w: 914400, h: 914400 }, path: [] },
        { id: 'inner-leaf', kind: 'shape', bounds: { x: 2743200, y: 914400, w: 914400, h: 914400 }, path: [] },
      ],
      groups: [
        { id: 'outer', bounds: { x: 914400, y: 914400, w: 4572000, h: 1828800 }, childIds: ['outer-leaf', 'inner'], ancestorIds: [], paintOrder: 1 },
        { id: 'inner', bounds: { x: 2286000, y: 914400, w: 2743200, h: 1828800 }, childIds: ['inner-leaf'], ancestorIds: ['outer'], paintOrder: 1 },
      ],
    }
    const selectEvents: unknown[] = []
    const app = createApp({
      setup: () => () => h(PptEditor, {
        scene: nestedScene,
        adapter,
        onSelect: (id: unknown) => selectEvents.push(id),
      }),
    })
    app.use(createPpt4aiI18n())
    const host = document.createElement('div')
    document.body.append(host)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      canvas: { width: 0, height: 0, style: { width: '', height: '' } }, clearRect: vi.fn(), setTransform: vi.fn(), save: vi.fn(), restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    app.mount(host)
    await nextTick()

    const canvas = host.querySelector('[data-slide-canvas]') as HTMLCanvasElement
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 960, height: 540 } as DOMRect)
    canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 97, clientY: 97, bubbles: true }))
    await nextTick()
    canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 289, clientY: 97, bubbles: true }))
    await nextTick()
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 289, clientY: 97, pointerId: 21, bubbles: true }))
    await nextTick()

    expect(selectEvents).toEqual(['outer', 'inner', 'inner-leaf'])
    const editor = host.querySelector('.ppt-editor') as HTMLElement
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await nextTick()
    expect(selectEvents).toEqual(['outer', 'inner', 'inner-leaf', 'outer'])
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await nextTick()
    expect(selectEvents).toEqual(['outer', 'inner', 'inner-leaf', 'outer', undefined])
    app.unmount()
  })

  it('returns to top-level selection when clicking outside the active group', async () => {
    const outsideScene: SceneGraph = {
      ...groupedScene,
      nodes: [
        { id: 'group-leaf', kind: 'shape', bounds: { x: 914400, y: 914400, w: 914400, h: 914400 }, path: [] },
        { id: 'standalone', kind: 'shape', bounds: { x: 6400800, y: 914400, w: 914400, h: 914400 }, path: [] },
      ],
      groups: [
        { id: 'outer', bounds: { x: 914400, y: 914400, w: 1828800, h: 1828800 }, childIds: ['group-leaf'], ancestorIds: [], paintOrder: 0 },
      ],
    }
    const selectEvents: unknown[] = []
    const app = createApp({
      setup: () => () => h(PptEditor, {
        scene: outsideScene,
        adapter,
        onSelect: (id: unknown) => selectEvents.push(id),
      }),
    })
    app.use(createPpt4aiI18n())
    const host = document.createElement('div')
    document.body.append(host)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      canvas: { width: 0, height: 0, style: { width: '', height: '' } }, clearRect: vi.fn(), setTransform: vi.fn(), save: vi.fn(), restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    app.mount(host)
    await nextTick()

    const canvas = host.querySelector('[data-slide-canvas]') as HTMLCanvasElement
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 960, height: 540 } as DOMRect)
    canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 97, clientY: 97, bubbles: true }))
    await nextTick()
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 673, clientY: 97, pointerId: 22, bubbles: true }))
    await nextTick()
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 97, clientY: 97, pointerId: 23, bubbles: true }))
    await nextTick()

    expect(selectEvents).toEqual(['outer', 'standalone', 'outer'])
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

  it('renders eight resize handles for a controlled multi-selection', async () => {
    const mounted = mountEditor({
      scene: multiSelectionScene,
      selectedElementIds: ['shape-1', 'shape-2'],
    })
    await nextTick()

    expect(mounted.host.querySelectorAll('[data-selection-handle]')).toHaveLength(8)
    expect(mounted.host.querySelector('[data-selection-border]')?.getAttribute('style')).toContain('width: 192px')
    mounted.app.unmount()
  })

  it('emits one multi-selection resize intent from the gesture-start selection', async () => {
    const resizeEvents: unknown[] = []
    const mounted = mountEditor({
      scene: multiSelectionScene,
      selectedElementIds: ['shape-1', 'shape-2'],
      onResizeSelection: (payload: unknown) => resizeEvents.push(payload),
    })
    await nextTick()

    const handle = mounted.host.querySelector('[data-selection-handle="se"]') as HTMLButtonElement
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 192, clientY: 96, pointerId: 20, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 288, clientY: 192, pointerId: 20, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 288, clientY: 192, pointerId: 20, bubbles: true }))

    expect(resizeEvents).toEqual([{
      elementIds: ['shape-1', 'shape-2'],
      bounds: { x: 0, y: 0, w: 2743200, h: 1828800 },
    }])
    mounted.app.unmount()
  })

  it('keeps a multi-selection corner resize proportional while Shift is held', async () => {
    const resizeEvents: unknown[] = []
    const mounted = mountEditor({
      scene: multiSelectionScene,
      selectedElementIds: ['shape-1', 'shape-2'],
      onResizeSelection: (payload: unknown) => resizeEvents.push(payload),
    })
    await nextTick()

    const handle = mounted.host.querySelector('[data-selection-handle="se"]') as HTMLButtonElement
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 192, clientY: 96, pointerId: 21, shiftKey: true, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 288, clientY: 160, pointerId: 21, shiftKey: true, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 288, clientY: 160, pointerId: 21, shiftKey: true, bubbles: true }))

    expect(resizeEvents).toEqual([{
      elementIds: ['shape-1', 'shape-2'],
      bounds: { x: 0, y: 0, w: 3048000, h: 1524000 },
    }])
    mounted.app.unmount()
  })

  it('previews a snapped resize guide without changing the controlled selection', async () => {
    const snapScene: SceneGraph = {
      slideId: 'slide-1',
      page: { w: 9144000, h: 5143500 },
      nodes: [
        { id: 'shape-1', kind: 'shape', bounds: { x: 0, y: 0, w: 914400, h: 914400 }, path: [] },
        { id: 'shape-2', kind: 'shape', bounds: { x: 2743200, y: 0, w: 914400, h: 914400 }, path: [] },
      ],
    }
    const mounted = mountEditor({
      scene: snapScene,
      selectedElementIds: ['shape-1'],
      snapOptions: { enabled: true, threshold: 100000 },
    })
    await nextTick()

    const handle = mounted.host.querySelector('[data-selection-handle="e"]') as HTMLButtonElement
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 96, clientY: 48, pointerId: 22, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 278, clientY: 48, pointerId: 22, bubbles: true }))
    await nextTick()

    expect(mounted.host.querySelector('[data-selection-border]')?.getAttribute('style')).toContain('width: 288px')
    expect(mounted.host.querySelectorAll('[data-snap-guide][data-snap-axis="x"]')).toHaveLength(1)
    expect(mounted.host.querySelector('[data-snap-guide]')?.getAttribute('style')).toContain('left: 288px')
    mounted.app.unmount()
  })

  it('clears resize preview and guides when the handle gesture is cancelled', async () => {
    const mounted = mountEditor({
      scene: multiSelectionScene,
      selectedElementIds: ['shape-1', 'shape-2'],
      snapOptions: { enabled: true, threshold: 100000 },
    })
    await nextTick()

    const handle = mounted.host.querySelector('[data-selection-handle="se"]') as HTMLButtonElement
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 192, clientY: 96, pointerId: 23, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 288, clientY: 192, pointerId: 23, bubbles: true }))
    await nextTick()
    expect(mounted.host.querySelector('[data-selection-border]')?.getAttribute('style')).toContain('width: 288px')

    handle.dispatchEvent(new PointerEvent('pointercancel', { clientX: 288, clientY: 192, pointerId: 23, bubbles: true }))
    await nextTick()

    expect(mounted.host.querySelector('[data-selection-border]')?.getAttribute('style')).toContain('width: 192px')
    expect(mounted.host.querySelectorAll('[data-snap-guide]')).toHaveLength(0)
    mounted.app.unmount()
  })

  it('does not commit a resize after the controlled selection changes mid-gesture', async () => {
    const resizeEvents: unknown[] = []
    const selectedIds = ref(['shape-1', 'shape-2'])
    const app = createApp({
      setup() {
        return () => h(PptEditor, {
          scene: multiSelectionScene,
          adapter,
          selectedElementIds: selectedIds.value,
          onResizeSelection: (payload: unknown) => resizeEvents.push(payload),
        })
      },
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

    const handle = host.querySelector('[data-selection-handle="se"]') as HTMLButtonElement
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 192, clientY: 96, pointerId: 24, bubbles: true }))
    selectedIds.value = ['shape-1']
    await nextTick()
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 288, clientY: 192, pointerId: 24, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 288, clientY: 192, pointerId: 24, bubbles: true }))

    expect(resizeEvents).toEqual([])
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

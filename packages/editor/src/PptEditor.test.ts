// @vitest-environment happy-dom
import type { AssetAdapter, TextBody } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import type { ImeInputBridge, ImeInputBridgeOptions } from '@ppt4ai/text'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPpt4aiI18n, locales } from './i18n'
import { rotationFromPointer } from './image-transform'
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

const imageScene: SceneGraph = {
  slideId: 'slide-1',
  page: { w: 9144000, h: 5143500 },
  nodes: [
    {
      id: 'image-1',
      kind: 'image',
      bounds: { x: 914400, y: 914400, w: 1828800, h: 914400 },
      assetId: 'asset-1',
      transform: { rotation: 900000 },
    },
    { id: 'image-guide', kind: 'shape', bounds: { x: 3657600, y: 3657600, w: 914400, h: 914400 }, path: [] },
  ],
}

function rotateScreenPoint(point: { x: number; y: number }, center: { x: number; y: number }, degrees: number): { x: number; y: number } {
  const radians = degrees * Math.PI / 180
  const dx = point.x - center.x
  const dy = point.y - center.y
  return {
    x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  }
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

  it('shows the rotation handle for any single rotatable element', async () => {
    const imageMounted = mountEditor({ scene: imageScene, selectedElementId: 'image-1' })
    await nextTick()

    expect(imageMounted.host.querySelectorAll('[data-selection-rotation-handle]')).toHaveLength(1)
    expect(imageMounted.host.querySelector('[data-selection-overlay]')).not.toBeNull()
    expect(imageMounted.host.querySelector('[data-selection-border]')).not.toBeNull()
    imageMounted.app.unmount()

    const shapeMounted = mount('shape-1')
    await nextTick()
    expect(shapeMounted.host.querySelectorAll('[data-selection-rotation-handle]')).toHaveLength(1)
    shapeMounted.app.unmount()

    const textMounted = mountEditor({ scene: textScene, selectedElementId: 'text-1' })
    await nextTick()
    expect(textMounted.host.querySelectorAll('[data-selection-rotation-handle]')).toHaveLength(1)
    textMounted.app.unmount()
  })

  it('hides the rotation handle for multi-selection and for a selected group', async () => {
    const multiMounted = mountEditor({ scene: multiSelectionScene, selectedElementIds: ['shape-1', 'shape-2'] })
    await nextTick()
    expect(multiMounted.host.querySelector('[data-selection-rotation-handle]')).toBeNull()
    multiMounted.app.unmount()

    const groupMounted = mountEditor({ scene: groupedScene, selectedElementId: 'group-1' })
    await nextTick()
    expect(groupMounted.host.querySelector('[data-selection-rotation-handle]')).toBeNull()
    groupMounted.app.unmount()
  })

  it('emits rotate-element for a shape gesture and snaps Shift to fifteen degrees', async () => {
    const rotateEvents: Array<{ elementId: string; rotation: number }> = []
    const mounted = mountEditor({
      selectedElementId: 'shape-1',
      onRotateElement: (payload: { elementId: string; rotation: number }) => rotateEvents.push(payload),
    })
    await nextTick()
    const canvasHost = mounted.host.querySelector('.ppt-editor__canvas') as HTMLElement
    vi.spyOn(canvasHost, 'getBoundingClientRect').mockReturnValue({ left: 40, top: 30, width: 960, height: 540 } as DOMRect)
    const handle = mounted.host.querySelector('[data-selection-rotation-handle]') as HTMLButtonElement
    const center = { x: 232, y: 174 }
    const startPoint = { x: 232, y: 110 }
    const currentPoint = { x: 296, y: 174 }

    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: startPoint.x, clientY: startPoint.y, pointerId: 41, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: currentPoint.x, clientY: currentPoint.y, pointerId: 41, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: currentPoint.x, clientY: currentPoint.y, pointerId: 41, bubbles: true }))

    expect(rotateEvents[0]).toEqual({
      elementId: 'shape-1',
      rotation: rotationFromPointer(0, center, startPoint, currentPoint),
    })

    const shiftedPoint = { x: 262, y: 112 }
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: startPoint.x, clientY: startPoint.y, pointerId: 42, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: shiftedPoint.x, clientY: shiftedPoint.y, shiftKey: true, pointerId: 42, bubbles: true }))
    expect(rotateEvents[1]!.rotation % 900000).toBe(0)
    mounted.app.unmount()
  })

  it('reads the shape gesture start angle from the existing rotation', async () => {
    const rotatedShapeScene: SceneGraph = {
      slideId: 'slide-1',
      page: { w: 9144000, h: 5143500 },
      nodes: [{ id: 'shape-1', kind: 'shape', bounds: { x: 914400, y: 914400, w: 1828800, h: 914400 }, path: [], transform: { rotation: 900000 } }],
    }
    const rotateEvents: Array<{ elementId: string; rotation: number }> = []
    const mounted = mountEditor({
      scene: rotatedShapeScene,
      selectedElementId: 'shape-1',
      onRotateElement: (payload: { elementId: string; rotation: number }) => rotateEvents.push(payload),
    })
    await nextTick()
    const canvasHost = mounted.host.querySelector('.ppt-editor__canvas') as HTMLElement
    vi.spyOn(canvasHost, 'getBoundingClientRect').mockReturnValue({ left: 40, top: 30, width: 960, height: 540 } as DOMRect)
    const handle = mounted.host.querySelector('[data-selection-rotation-handle]') as HTMLButtonElement
    const center = { x: 232, y: 174 }
    const startPoint = { x: 232, y: 110 }
    const currentPoint = { x: 296, y: 174 }

    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: startPoint.x, clientY: startPoint.y, pointerId: 43, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: currentPoint.x, clientY: currentPoint.y, pointerId: 43, bubbles: true }))

    expect(rotateEvents[0]).toEqual({
      elementId: 'shape-1',
      rotation: rotationFromPointer(900000, center, startPoint, currentPoint),
    })
    mounted.app.unmount()
  })

  it('renders image transform buttons only for a single image and emits typed intents', async () => {
    const rotateEvents: unknown[] = []
    const flipEvents: unknown[] = []
    const imageMounted = mountEditor({
      scene: imageScene,
      selectedElementId: 'image-1',
      onRotateImage: (payload: unknown) => rotateEvents.push(payload),
      onFlipImage: (payload: unknown) => flipEvents.push(payload),
    })
    await nextTick()

    expect(imageMounted.host.querySelectorAll('[data-image-transform-button]')).toHaveLength(4)
    expect([...imageMounted.host.querySelectorAll('[data-image-transform-button]')].map((button) => button.getAttribute('data-image-transform-button'))).toEqual([
      'rotate-left',
      'rotate-right',
      'flip-horizontal',
      'flip-vertical',
    ])
    ;(imageMounted.host.querySelector('[data-image-transform-button="rotate-left"]') as HTMLButtonElement).click()
    ;(imageMounted.host.querySelector('[data-image-transform-button="rotate-right"]') as HTMLButtonElement).click()
    ;(imageMounted.host.querySelector('[data-image-transform-button="flip-horizontal"]') as HTMLButtonElement).click()
    ;(imageMounted.host.querySelector('[data-image-transform-button="flip-vertical"]') as HTMLButtonElement).click()
    expect(rotateEvents).toEqual([
      { elementId: 'image-1', rotation: -4500000 },
      { elementId: 'image-1', rotation: 6300000 },
    ])
    expect(flipEvents).toEqual([
      { elementId: 'image-1', axis: 'horizontal' },
      { elementId: 'image-1', axis: 'vertical' },
    ])
    imageMounted.app.unmount()

    const shapeRotateEvents: unknown[] = []
    const shapeMounted = mountEditor({
      scene,
      selectedElementId: 'shape-1',
      onRotateElement: (payload: unknown) => shapeRotateEvents.push(payload),
    })
    await nextTick()

    expect([...shapeMounted.host.querySelectorAll('[data-image-transform-button]')].map((button) => button.getAttribute('data-image-transform-button'))).toEqual([
      'rotate-left',
      'rotate-right',
    ])
    ;(shapeMounted.host.querySelector('[data-image-transform-button="rotate-left"]') as HTMLButtonElement).click()
    expect(shapeRotateEvents).toEqual([{ elementId: 'shape-1', rotation: -5400000 }])
    shapeMounted.app.unmount()
  })

  it('exposes localized image transform labels and statuses in both locales', () => {
    for (const locale of Object.values(locales)) {
      expect(locale.toolbar.object.rotateLeft).toBeTruthy()
      expect(locale.toolbar.object.rotateRight).toBeTruthy()
      expect(locale.toolbar.object.flipHorizontal).toBeTruthy()
      expect(locale.toolbar.object.flipVertical).toBeTruthy()
      expect(locale.status.imageRotated).toBeTruthy()
      expect(locale.status.imageFlipped).toBeTruthy()
    }
  })

  it('emits exact image rotation values and snaps Shift gestures to fifteen degrees', async () => {
    const rotateEvents: Array<{ elementId: string; rotation: number }> = []
    const mounted = mountEditor({
      scene: imageScene,
      selectedElementId: 'image-1',
      onRotateImage: (payload: { elementId: string; rotation: number }) => rotateEvents.push(payload),
    })
    await nextTick()
    const canvasHost = mounted.host.querySelector('.ppt-editor__canvas') as HTMLElement
    vi.spyOn(canvasHost, 'getBoundingClientRect').mockReturnValue({ left: 40, top: 30, width: 960, height: 540 } as DOMRect)
    const handle = mounted.host.querySelector('[data-selection-rotation-handle]') as HTMLButtonElement
    const center = { x: 232, y: 174 }
    const startPoint = { x: 232, y: 110 }
    const currentPoint = { x: 296, y: 174 }

    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: startPoint.x, clientY: startPoint.y, pointerId: 30, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: currentPoint.x, clientY: currentPoint.y, pointerId: 30, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: currentPoint.x, clientY: currentPoint.y, pointerId: 30, bubbles: true }))

    expect(rotateEvents[0]).toEqual({
      elementId: 'image-1',
      rotation: rotationFromPointer(900000, center, startPoint, currentPoint),
    })

    const shiftedPoint = { x: 262, y: 112 }
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: startPoint.x, clientY: startPoint.y, pointerId: 31, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: shiftedPoint.x, clientY: shiftedPoint.y, pointerId: 31, shiftKey: true, bubbles: true }))

    expect(rotateEvents[1]).toEqual({
      elementId: 'image-1',
      rotation: rotationFromPointer(900000, center, startPoint, shiftedPoint, true),
    })
    expect(rotateEvents[1]!.rotation % 900000).toBe(0)
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

  it('keeps a rotated image center during Alt resize and shows the used snap guide', async () => {
    const resizeEvents: Array<{ elementId: string; bounds: { x: number; y: number; w: number; h: number } }> = []
    const mounted = mountEditor({
      scene: imageScene,
      selectedElementId: 'image-1',
      snapOptions: { enabled: true, threshold: 100000 },
      onResize: (payload: { elementId: string; bounds: { x: number; y: number; w: number; h: number } }) => resizeEvents.push(payload),
    })
    await nextTick()
    const canvas = mounted.host.querySelector('[data-slide-canvas]') as HTMLCanvasElement
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 960, height: 540 } as DOMRect)
    const handle = mounted.host.querySelector('[data-selection-handle="e"]') as HTMLButtonElement
    const center = { x: 192, y: 144 }
    const startPoint = rotateScreenPoint({ x: 288, y: 144 }, center, 15)
    const currentPoint = rotateScreenPoint({ x: 384, y: 144 }, center, 15)

    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: startPoint.x, clientY: startPoint.y, pointerId: 32, altKey: true, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: currentPoint.x, clientY: currentPoint.y, pointerId: 32, altKey: true, bubbles: true }))
    await nextTick()
    expect(mounted.host.querySelectorAll('[data-snap-guide][data-snap-axis="x"]')).toHaveLength(1)
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: currentPoint.x, clientY: currentPoint.y, pointerId: 32, altKey: true, bubbles: true }))

    const resized = resizeEvents[0]!.bounds
    expect(resized.x + resized.w / 2).toBe(1828800)
    expect(resized.y + resized.h / 2).toBe(1371600)
    mounted.app.unmount()
  })

  it('keeps a rotated image center and ratio during Alt-Shift corner resize', async () => {
    const resizeEvents: Array<{ elementId: string; bounds: { x: number; y: number; w: number; h: number } }> = []
    const mounted = mountEditor({
      scene: imageScene,
      selectedElementId: 'image-1',
      onResize: (payload: { elementId: string; bounds: { x: number; y: number; w: number; h: number } }) => resizeEvents.push(payload),
    })
    await nextTick()
    const canvas = mounted.host.querySelector('[data-slide-canvas]') as HTMLCanvasElement
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 960, height: 540 } as DOMRect)
    const handle = mounted.host.querySelector('[data-selection-handle="se"]') as HTMLButtonElement
    const center = { x: 192, y: 144 }
    const startPoint = rotateScreenPoint({ x: 288, y: 192 }, center, 15)
    const currentPoint = rotateScreenPoint({ x: 336, y: 216 }, center, 15)

    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: startPoint.x, clientY: startPoint.y, pointerId: 33, shiftKey: true, altKey: true, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: currentPoint.x, clientY: currentPoint.y, pointerId: 33, shiftKey: true, altKey: true, bubbles: true }))

    const resized = resizeEvents[0]!.bounds
    expect(resized.w / resized.h).toBeCloseTo(2)
    expect(resized.x + resized.w / 2).toBeCloseTo(1828800)
    expect(resized.y + resized.h / 2).toBeCloseTo(1371600)
    mounted.app.unmount()
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

  it('does not commit image gestures after controlled selection or scene changes', async () => {
    const rotateEvents: unknown[] = []
    const resizeEvents: unknown[] = []
    const selectedIds = ref(['image-1'])
    const controlledScene = ref(imageScene)
    const app = createApp({
      setup() {
        return () => h(PptEditor, {
          scene: controlledScene.value,
          adapter,
          decoder: async (): Promise<DecodedImage> => ({ source: {} as CanvasImageSource, width: 1, height: 1 }),
          selectedElementIds: selectedIds.value,
          onRotateImage: (payload: unknown) => rotateEvents.push(payload),
          onResize: (payload: unknown) => resizeEvents.push(payload),
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
    const canvas = host.querySelector('[data-slide-canvas]') as HTMLCanvasElement
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 960, height: 540 } as DOMRect)
    const rotationHandle = host.querySelector('[data-selection-rotation-handle]') as HTMLButtonElement

    rotationHandle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 192, clientY: 80, pointerId: 34, bubbles: true }))
    selectedIds.value = ['image-guide']
    await nextTick()
    rotationHandle.dispatchEvent(new PointerEvent('pointerup', { clientX: 256, clientY: 144, pointerId: 34, bubbles: true }))
    expect(rotateEvents).toEqual([])

    selectedIds.value = ['image-1']
    await nextTick()
    const resizeHandle = host.querySelector('[data-selection-handle="se"]') as HTMLButtonElement
    resizeHandle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 288, clientY: 192, pointerId: 35, bubbles: true }))
    controlledScene.value = structuredClone(imageScene)
    await nextTick()
    resizeHandle.dispatchEvent(new PointerEvent('pointerup', { clientX: 336, clientY: 240, pointerId: 35, bubbles: true }))
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

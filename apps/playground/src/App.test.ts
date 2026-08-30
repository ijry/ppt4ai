// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import type { App as VueApp } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPpt4aiI18n } from '@ppt4ai/editor'

vi.mock('./thumbnail-smoke', () => ({
  createThumbnailScene: (color: 'red' | 'blue') => ({
    slideId: `slide-${color}`,
    page: { w: 1000, h: 562.5 },
    nodes: [],
  }),
  thumbnailAdapter: { get: async () => undefined, put: async () => {} },
}))

import App from './App.vue'

const uploadPng = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 3, 0, 0, 0, 4, 8, 6, 0, 0, 0, 0, 0, 0, 0,
])

const mountedApps: VueApp[] = []

class TestWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null

  postMessage(message: unknown): void {
    const request = message as { type?: string; requestId?: number }
    if (request.type !== 'render') return
    queueMicrotask(() => this.onmessage?.({ data: {
      type: 'render-result',
      requestId: request.requestId,
      result: { drawnNodeIds: [], skippedNodeIds: [], issues: [] },
    } } as MessageEvent))
  }

  terminate(): void {}
}

function mountApp() {
  const bitmapContext = {
    canvas: { width: 0, height: 0, style: { width: '', height: '' } },
    transferFromImageBitmap: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(bitmapContext as unknown as RenderingContext)
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
  vi.stubGlobal('Worker', TestWorker)
  const app = createApp(App)
  const host = document.createElement('div')
  document.body.append(host)
  app.use(createPpt4aiI18n('zh-CN')).mount(host)
  mountedApps.push(app)
  return { app, host }
}

async function chooseFile(host: HTMLElement, file: File): Promise<HTMLInputElement> {
  const input = host.querySelector('[data-testid="image-file-input"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  input.dispatchEvent(new Event('change'))
  await nextTick()
  await vi.waitFor(() => expect(host.querySelector('[data-testid="upload-busy"]')).toBeNull())
  return input
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('Playground asset host wiring', () => {
  it('renders navigable page thumbnails and switches the active page', async () => {
    const { app, host } = mountApp()
    await nextTick()

    const redThumbnail = host.querySelector('[data-testid="slide-thumbnail-sld_playground"]') as HTMLButtonElement
    const blueThumbnail = host.querySelector('[data-testid="slide-thumbnail-sld_playground_blue"]') as HTMLButtonElement
    expect(redThumbnail).not.toBeNull()
    expect(blueThumbnail).not.toBeNull()
    expect(redThumbnail.getAttribute('aria-current')).toBe('page')
    expect(blueThumbnail.getAttribute('aria-current')).toBeNull()

    blueThumbnail.click()
    await nextTick()

    expect(blueThumbnail.getAttribute('aria-current')).toBe('page')
    expect(redThumbnail.getAttribute('aria-current')).toBeNull()
    expect(host.querySelector('[data-testid="undo-depth"]')?.textContent).toContain('0')
    expect(host.querySelector('[data-testid="selected-element"]')?.textContent).toContain('—')
    expect(host.querySelector('[data-testid="asset-status"]')?.textContent).toContain('已选择页面')
    app.unmount()
    mountedApps.splice(mountedApps.indexOf(app), 1)
  })

  it('restores each page selection after switching away and back', async () => {
    const { app, host } = mountApp()
    await nextTick()
    const canvas = host.querySelector('[data-slide-canvas]') as HTMLCanvasElement
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1280, height: 720 } as DOMRect)

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 140, clientY: 110, bubbles: true }))
    await nextTick()
    expect(host.querySelector('[data-testid="selected-element"]')?.textContent).toContain('group_demo')

    ;(host.querySelector('[data-testid="slide-thumbnail-sld_playground_blue"]') as HTMLButtonElement).click()
    await nextTick()
    expect(host.querySelector('[data-testid="selected-element"]')?.textContent).toContain('—')

    ;(host.querySelector('[data-testid="slide-thumbnail-sld_playground"]') as HTMLButtonElement).click()
    await nextTick()
    expect(host.querySelector('[data-testid="selected-element"]')?.textContent).toContain('group_demo')
    app.unmount()
    mountedApps.splice(mountedApps.indexOf(app), 1)
  })

  it('renders the seeded scene and selects a node from the slide canvas', async () => {
    const { app, host } = mountApp()
    await nextTick()

    const canvas = host.querySelector('[data-slide-canvas]') as HTMLCanvasElement
    expect(canvas).not.toBeNull()
    expect(canvas.width).toBeGreaterThan(0)
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1280,
      bottom: 720,
      width: 1280,
      height: 720,
      toJSON: () => ({}),
    })

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 140, clientY: 110, bubbles: true }))
    await nextTick()

    expect(host.querySelector('[data-testid="selected-element"]')?.textContent).toContain('group_demo')
    expect(host.querySelector('[data-testid="undo-depth"]')?.textContent).toContain('0')
    expect(host.querySelector('[data-selection-overlay]')).not.toBeNull()
    app.unmount()
    mountedApps.splice(mountedApps.indexOf(app), 1)
  })

  it('commits a canvas drag as one undoable move', async () => {
    const { app, host } = mountApp()
    await nextTick()
    const canvas = host.querySelector('[data-slide-canvas]') as HTMLCanvasElement
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1280, height: 720 } as DOMRect)

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 140, clientY: 110, pointerId: 3, bubbles: true }))
    await nextTick()
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 160, clientY: 130, pointerId: 3, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 160, clientY: 130, pointerId: 3, bubbles: true }))
    await nextTick()

    expect(host.querySelector('[data-testid="selected-element"]')?.textContent).toContain('group_demo')
    expect(host.querySelector('[data-testid="undo-depth"]')?.textContent).toContain('1')
    expect(host.querySelector('[data-selection-border]')?.getAttribute('style')).toContain('left: 116px')
    app.unmount()
    mountedApps.splice(mountedApps.indexOf(app), 1)
  })

  it('groups and ungroups a modifier multi-selection through the editor toolbar', async () => {
    const { app, host } = mountApp()
    await nextTick()
    const canvas = host.querySelector('[data-slide-canvas]') as HTMLCanvasElement
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1280, height: 720 } as DOMRect)

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 140, clientY: 110, pointerId: 31, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 140, clientY: 110, pointerId: 31, bubbles: true }))
    await nextTick()
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 140, clientY: 300, pointerId: 32, shiftKey: true, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 140, clientY: 300, pointerId: 32, shiftKey: true, bubbles: true }))
    await nextTick()

    expect(host.querySelector('[data-testid="selected-element"]')?.textContent).toContain('group_demo, table_demo')
    expect(host.querySelectorAll('[data-selection-handle]')).toHaveLength(8)
    const groupButton = host.querySelector('[data-group-button]') as HTMLButtonElement
    expect(groupButton.disabled).toBe(false)
    groupButton.click()
    await nextTick()

    expect(host.querySelector('[data-testid="selected-element"]')?.textContent).toContain('grp_1')
    expect(host.querySelector('[data-testid="undo-depth"]')?.textContent).toContain('1')
    expect((host.querySelector('[data-ungroup-button]') as HTMLButtonElement).disabled).toBe(false)
    ;(host.querySelector('[data-ungroup-button]') as HTMLButtonElement).click()
    await nextTick()

    expect(host.querySelector('[data-testid="selected-element"]')?.textContent).toContain('group_demo, table_demo')
    expect(host.querySelector('[data-testid="undo-depth"]')?.textContent).toContain('2')
    expect(host.querySelectorAll('[data-selection-handle]')).toHaveLength(8)
    app.unmount()
    mountedApps.splice(mountedApps.indexOf(app), 1)
  })

  it('preserves a modifier multi-selection while dragging one selected member', async () => {
    const { app, host } = mountApp()
    await nextTick()
    const canvas = host.querySelector('[data-slide-canvas]') as HTMLCanvasElement
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1280, height: 720 } as DOMRect)

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 140, clientY: 110, pointerId: 41, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 140, clientY: 110, pointerId: 41, bubbles: true }))
    await nextTick()
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 140, clientY: 300, pointerId: 42, shiftKey: true, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 140, clientY: 300, pointerId: 42, shiftKey: true, bubbles: true }))
    await nextTick()

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 140, clientY: 110, pointerId: 43, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 160, clientY: 130, pointerId: 43, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 160, clientY: 130, pointerId: 43, bubbles: true }))
    await nextTick()

    expect(host.querySelector('[data-testid="selected-element"]')?.textContent).toContain('group_demo, table_demo')
    expect(host.querySelector('[data-testid="undo-depth"]')?.textContent).toContain('1')
    expect(host.querySelector('[data-selection-border]')?.getAttribute('style')).toContain('left: 116px')
    expect(host.querySelectorAll('[data-selection-handle]')).toHaveLength(8)
    app.unmount()
    mountedApps.splice(mountedApps.indexOf(app), 1)
  })

  it('resizes a modifier multi-selection through one selection-handle transaction', async () => {
    const { app, host } = mountApp()
    await nextTick()
    const canvas = host.querySelector('[data-slide-canvas]') as HTMLCanvasElement
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1280, height: 720 } as DOMRect)

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 140, clientY: 110, pointerId: 51, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 140, clientY: 110, pointerId: 51, bubbles: true }))
    await nextTick()
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 140, clientY: 300, pointerId: 52, shiftKey: true, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 140, clientY: 300, pointerId: 52, shiftKey: true, bubbles: true }))
    await nextTick()

    const handle = host.querySelector('[data-selection-handle="se"]') as HTMLButtonElement
    expect(handle).not.toBeNull()
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 384, clientY: 372, pointerId: 53, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 480, clientY: 372, pointerId: 53, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 480, clientY: 372, pointerId: 53, bubbles: true }))
    await nextTick()

    expect(host.querySelector('[data-testid="selected-element"]')?.textContent).toContain('group_demo, table_demo')
    expect(host.querySelector('[data-testid="undo-depth"]')?.textContent).toContain('1')
    expect(host.querySelector('[data-selection-border]')?.getAttribute('style')).toContain('width: 384px')
    expect(host.querySelectorAll('[data-selection-handle]')).toHaveLength(8)
    app.unmount()
    mountedApps.splice(mountedApps.indexOf(app), 1)
  })

  it('selects, inserts, and replaces seeded asset references', async () => {
    const { app, host } = mountApp()
    await nextTick()

    expect([...host.querySelectorAll('[data-asset-id]')].map((item) => item.getAttribute('data-asset-id'))).toEqual(['asset_blue', 'asset_red'])

    ;(host.querySelector('[data-asset-id="asset_red"] [data-asset-select]') as HTMLButtonElement).click()
    await nextTick()
    expect(host.querySelector('[data-testid="asset-selected"]')?.textContent).toContain('asset_red')

    ;(host.querySelector('[data-asset-id="asset_red"] [data-asset-insert]') as HTMLButtonElement).click()
    await nextTick()
    expect(host.querySelector('[data-testid="selected-element"]')?.textContent).toContain('image_1')
    expect(host.querySelector('[data-testid="undo-depth"]')?.textContent).toContain('1')
    expect(host.querySelector('[data-testid="asset-status"]')?.textContent).toContain('已插入图片')

    ;(host.querySelector('[data-asset-id="asset_blue"] [data-asset-select]') as HTMLButtonElement).click()
    await nextTick()
    ;(host.querySelector('[data-asset-id="asset_blue"] [data-asset-replace]') as HTMLButtonElement).click()
    await nextTick()
    expect(host.querySelector('[data-testid="asset-selected"]')?.textContent).toContain('asset_blue')
    expect(host.querySelector('[data-testid="selected-element"]')?.textContent).toContain('asset_blue')
    expect(host.querySelector('[data-testid="asset-status"]')?.textContent).toContain('已替换图片')
    expect(host.querySelector('[data-testid="undo-depth"]')?.textContent).toContain('2')
    app.unmount()
    mountedApps.splice(mountedApps.indexOf(app), 1)
  })

  it('wires all image transform buttons to the real asset host', async () => {
    const { app, host } = mountApp()
    await nextTick()

    ;(host.querySelector('[data-asset-id="asset_red"] [data-asset-insert]') as HTMLButtonElement).click()
    await nextTick()
    expect(host.querySelectorAll('[data-image-transform-button]')).toHaveLength(4)
    expect(host.querySelector('[data-testid="undo-depth"]')?.textContent).toContain('1')

    ;(host.querySelector('[data-image-transform-button="rotate-right"]') as HTMLButtonElement).click()
    await nextTick()
    expect(host.querySelector('[data-testid="undo-depth"]')?.textContent).toContain('2')
    expect(host.querySelector('[data-testid="asset-status"]')?.textContent).toContain('图片已旋转')
    expect(host.querySelector('[data-selection-frame]')?.getAttribute('style')).toContain('rotate(90deg)')

    ;(host.querySelector('[data-image-transform-button="flip-horizontal"]') as HTMLButtonElement).click()
    await nextTick()
    expect(host.querySelector('[data-testid="undo-depth"]')?.textContent).toContain('3')
    expect(host.querySelector('[data-testid="asset-status"]')?.textContent).toContain('图片已翻转')

    ;(host.querySelector('[data-image-transform-button="rotate-left"]') as HTMLButtonElement).click()
    await nextTick()
    expect(host.querySelector('[data-testid="undo-depth"]')?.textContent).toContain('4')
    expect(host.querySelector('[data-selection-frame]')?.getAttribute('style')).toContain('rotate(0deg)')

    ;(host.querySelector('[data-image-transform-button="flip-vertical"]') as HTMLButtonElement).click()
    await nextTick()
    expect(host.querySelector('[data-testid="undo-depth"]')?.textContent).toContain('5')
    expect(host.querySelector('[data-testid="selected-element"]')?.textContent).toContain('image_1')
    app.unmount()
    mountedApps.splice(mountedApps.indexOf(app), 1)
  })

  it('reports a localized target error without changing history', async () => {
    const { app, host } = mountApp()
    await nextTick()

    ;(host.querySelector('[data-asset-id="asset_blue"] [data-asset-replace]') as HTMLButtonElement).click()
    await nextTick()
    expect(host.querySelector('[data-testid="asset-status"]')?.textContent).toContain('请先选择一张图片')
    expect(host.querySelector('[data-testid="undo-depth"]')?.textContent).toContain('0')
    expect(host.textContent).not.toContain('Error:')
    app.unmount()
    mountedApps.splice(mountedApps.indexOf(app), 1)
  })

  it('uploads a local image and inserts it into the document', async () => {
    const { app, host } = mountApp()
    await nextTick()

    ;(host.querySelector('[data-testid="upload-insert"]') as HTMLButtonElement).click()
    const input = await chooseFile(host, new File([uploadPng], 'local.png', { type: 'image/png' }))
    await vi.waitFor(() => expect(host.querySelector('[data-asset-id="asset_upload_1"]')).not.toBeNull())

    expect(host.querySelector('[data-asset-id="asset_upload_1"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="selected-element"]')?.textContent).toContain('image_1')
    expect(host.querySelector('[data-testid="undo-depth"]')?.textContent).toContain('1')
    expect(host.querySelector('[data-testid="asset-status"]')?.textContent).toContain('已上传并插入图片')
    expect(input.value).toBe('')
    app.unmount()
    mountedApps.splice(mountedApps.indexOf(app), 1)
  })

  it('uploads a local image to replace the selected image', async () => {
    const { app, host } = mountApp()
    await nextTick()
    ;(host.querySelector('[data-testid="upload-insert"]') as HTMLButtonElement).click()
    await chooseFile(host, new File([uploadPng], 'first.png', { type: 'image/png' }))

    const replacement = new Uint8Array(uploadPng)
    replacement[35] = 7
    ;(host.querySelector('[data-testid="upload-replace"]') as HTMLButtonElement).click()
    await chooseFile(host, new File([replacement], 'second.png', { type: 'image/png' }))
    await vi.waitFor(() => expect(host.querySelector('[data-asset-id="asset_upload_2"]')).not.toBeNull())

    expect(host.querySelector('[data-asset-id="asset_upload_1"]')).toBeNull()
    expect(host.querySelector('[data-asset-id="asset_upload_2"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="selected-element"]')?.textContent).toContain('asset_upload_2')
    expect(host.querySelector('[data-testid="undo-depth"]')?.textContent).toContain('2')
    expect(host.querySelector('[data-testid="asset-status"]')?.textContent).toContain('已上传并替换图片')
    app.unmount()
    mountedApps.splice(mountedApps.indexOf(app), 1)
  })

  it('reports a localized upload replacement target error', async () => {
    const { app, host } = mountApp()
    await nextTick()

    ;(host.querySelector('[data-testid="upload-replace"]') as HTMLButtonElement).click()
    await chooseFile(host, new File([uploadPng], 'replacement.png', { type: 'image/png' }))

    expect(host.querySelector('[data-testid="asset-status"]')?.textContent).toContain('请先选择一张图片')
    expect(host.querySelector('[data-testid="undo-depth"]')?.textContent).toContain('0')
    expect(host.textContent).not.toContain('Error:')
    app.unmount()
    mountedApps.splice(mountedApps.indexOf(app), 1)
  })
})

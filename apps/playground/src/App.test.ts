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
  const bitmapContext = { transferFromImageBitmap: vi.fn() }
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

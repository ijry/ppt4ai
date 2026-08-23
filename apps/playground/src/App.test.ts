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
  vi.stubGlobal('Worker', TestWorker)
  const app = createApp(App)
  const host = document.createElement('div')
  document.body.append(host)
  app.use(createPpt4aiI18n('zh-CN')).mount(host)
  mountedApps.push(app)
  return { app, host }
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
})

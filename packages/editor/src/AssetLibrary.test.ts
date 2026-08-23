// @vitest-environment happy-dom
import type { AssetAdapter, AssetMetadata } from '@ppt4ai/model'
import { createApp, h, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AssetLibrary from './AssetLibrary.vue'
import { createPpt4aiI18n } from './i18n'
import type { ThumbnailWorkerPort } from './thumbnail-renderer'
import type { ThumbnailRenderResponse, ThumbnailWorkerRequest } from './thumbnail-protocol'

class TestWorker implements ThumbnailWorkerPort {
  readonly posts: ThumbnailWorkerRequest[] = []
  terminateCalls = 0
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postMessage(message: unknown): void { this.posts.push(message as ThumbnailWorkerRequest) }
  terminate(): void { this.terminateCalls += 1 }
  emit(response: ThumbnailRenderResponse): void { this.onmessage?.({ data: response } as MessageEvent) }
}

const adapter: AssetAdapter = { get: async () => new Uint8Array([1]), put: async () => {} }
const assets: Record<string, AssetMetadata> = {
  asset_z: { id: 'asset_z', mimeType: 'image/png', pixelWidth: 640, pixelHeight: 360, originalFilename: 'Zoo.png' },
  asset_a: { id: 'asset_a', mimeType: 'image/jpeg', pixelWidth: 320, pixelHeight: 180, originalFilename: 'alpha.jpg' },
  asset_unknown: { id: 'asset_unknown', mimeType: 'image/gif' },
}

function mountLibrary(props: Record<string, unknown> = {}) {
  const bitmapContext = { transferFromImageBitmap: vi.fn() }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(bitmapContext as unknown as RenderingContext)
  const workers: TestWorker[] = []
  const events: Array<{ name: string; value: unknown }> = []
  const app = createApp({
    setup: () => () => h(AssetLibrary, {
      assets,
      adapter,
      workerFactory: { create: () => { const worker = new TestWorker(); workers.push(worker); return worker } },
      ...props,
      onSelect: (value: string) => events.push({ name: 'select', value }),
      onInsert: (value: string) => events.push({ name: 'insert', value }),
      onReplace: (value: string) => events.push({ name: 'replace', value }),
    }),
  })
  const host = document.createElement('div')
  document.body.append(host)
  app.use(createPpt4aiI18n('zh-CN')).mount(host)
  return { app, host, workers, events }
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('AssetLibrary', () => {
  it('renders an empty state when no assets exist', () => {
    const { app, host } = mountLibrary({ assets: {} })

    expect(host.querySelector('[role="status"]')?.textContent).toContain('暂无图片素材')
    app.unmount()
  })

  it('renders sorted metadata and emits select, insert, and replace intents', async () => {
    const { app, host, events } = mountLibrary()
    await nextTick()

    const items = [...host.querySelectorAll('[data-asset-id]')]
    expect(items.map((item) => item.getAttribute('data-asset-id'))).toEqual(['asset_a', 'asset_unknown', 'asset_z'])
    expect(host.textContent).toContain('alpha.jpg')
    expect(host.textContent).toContain('JPG')
    expect(host.textContent).toContain('320 × 180')
    expect(host.textContent).toContain('未命名图片（asset_unknown）')
    expect(host.textContent).toContain('尺寸未知')

    ;(items[0]!.querySelector('[data-asset-select]') as HTMLButtonElement).click()
    ;(items[0]!.querySelector('[data-asset-insert]') as HTMLButtonElement).click()
    ;(items[0]!.querySelector('[data-asset-replace]') as HTMLButtonElement).click()
    expect(events).toEqual([
      { name: 'select', value: 'asset_a' },
      { name: 'insert', value: 'asset_a' },
      { name: 'replace', value: 'asset_a' },
    ])
    app.unmount()
  })

  it('keeps selected styling and supports keyboard selection', async () => {
    const { app, host, events } = mountLibrary({ selectedAssetId: 'asset_z' })
    await nextTick()

    const selected = host.querySelector('[data-asset-id="asset_z"]') as HTMLElement
    expect(selected.className).toContain('border-pink-500')
    const selector = selected.querySelector('[data-asset-select]') as HTMLButtonElement
    selector.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(events).toEqual([{ name: 'select', value: 'asset_z' }])
    app.unmount()
  })

  it('shows a local thumbnail failure without hiding sibling assets', async () => {
    const { app, host, workers } = mountLibrary()
    await nextTick()
    workers[0]!.emit({
      type: 'render-result',
      requestId: 1,
      result: { drawnNodeIds: [], skippedNodeIds: ['asset_a'], issues: [{ nodeId: 'asset_a', assetId: 'asset_a', code: 'worker-failed', message: 'worker crashed' }] },
    })
    expect(host.querySelectorAll('[data-asset-select]')).toHaveLength(3)
    await vi.waitFor(() => {
      expect(host.querySelector('[data-asset-id="asset_a"] [role="status"]')?.textContent).toContain('缩略图不可用')
    })
    app.unmount()
  })

  it('does not rerender a successful thumbnail when its failure state is unchanged', async () => {
    const { app, workers } = mountLibrary({ assets: { asset_a: assets.asset_a } })
    await nextTick()

    workers[0]!.emit({
      type: 'render-result',
      requestId: 1,
      result: { drawnNodeIds: ['asset_a'], skippedNodeIds: [], issues: [] },
    })
    await nextTick()
    await nextTick()

    expect(workers[0]!.posts).toHaveLength(1)
    app.unmount()
  })
})

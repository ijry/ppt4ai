import type { AssetAdapter, AssetMetadata } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import { describe, expect, it, vi } from 'vitest'
import { createThumbnailRenderer, type ThumbnailWorkerPort } from './thumbnail-renderer'
import type { ThumbnailRenderResponse, ThumbnailResourceRequest, ThumbnailWorkerRequest } from './thumbnail-protocol'

class TestAdapter implements AssetAdapter {
  readonly calls: string[] = []
  readonly assets = new Map<string, Uint8Array | undefined>()
  error?: Error
  async get(assetId: string): Promise<Uint8Array | undefined> {
    this.calls.push(assetId)
    if (this.error) throw this.error
    return this.assets.get(assetId)
  }
  async put(_id: string, _data: Uint8Array, _metadata: AssetMetadata): Promise<void> {}
}

class TestWorker implements ThumbnailWorkerPort {
  readonly posts: Array<{ message: ThumbnailWorkerRequest; transfer: Transferable[] }> = []
  terminateCalls = 0
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postMessage(message: unknown, transfer: Transferable[] = []): void { this.posts.push({ message: message as ThumbnailWorkerRequest, transfer }) }
  terminate(): void { this.terminateCalls += 1 }
  emit(message: ThumbnailResourceRequest | ThumbnailRenderResponse): void { this.onmessage?.({ data: message } as MessageEvent) }
  fail(message: string): void { this.onerror?.({ message } as ErrorEvent) }
}

function scene(assetId = 'asset-a'): SceneGraph {
  return { slideId: 'slide-1', page: { w: 1000, h: 500 }, nodes: [{ id: 'image-a', kind: 'image', bounds: { x: 0, y: 0, w: 1000, h: 500 }, assetId, metadata: { id: assetId, mimeType: 'image/png' } }] }
}

function bitmap() { return { close: vi.fn() } as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> } }
function canvas() {
  const context = { transferFromImageBitmap: vi.fn() }
  const target = { width: 0, height: 0, style: { width: '', height: '' }, getContext: vi.fn((kind: string) => kind === 'bitmaprenderer' ? context : null) } as unknown as HTMLCanvasElement
  return { target, context }
}
function result(requestId: number, imageBitmap = bitmap()): ThumbnailRenderResponse {
  return { type: 'render-result', requestId, bitmap: imageBitmap, result: { drawnNodeIds: ['image-a'], skippedNodeIds: [], issues: [] } }
}

describe('thumbnail renderer', () => {
  it('clones scene, bridges copied bytes, and presents bitmap', async () => {
    const worker = new TestWorker()
    const adapter = new TestAdapter()
    const bytes = new Uint8Array([1, 2, 3])
    adapter.assets.set('asset-a', bytes)
    const visible = canvas()
    const renderer = createThumbnailRenderer({ adapter, workerFactory: { create: () => worker }, resourceContext: 'document-1' })
    const source = scene()
    const pending = renderer.render(source, visible.target, { width: 120, height: 68, devicePixelRatio: 2 })
    const request = worker.posts[0]!.message as Extract<ThumbnailWorkerRequest, { type: 'render' }>
    expect(request).toMatchObject({ requestId: 1, viewport: { width: 240, height: 136, devicePixelRatio: 2 }, resourceContext: 'document-1' })
    expect(request.scene).toEqual(source)
    expect(request.scene).not.toBe(source)
    expect(visible.target).toMatchObject({ width: 240, height: 136, style: { width: '120px', height: '68px' } })
    worker.emit({ type: 'resource-request', requestId: 1, resourceRequestId: 1, assetId: 'asset-a' })
    await vi.waitFor(() => expect(worker.posts.some((entry) => entry.message.type === 'resource-response')).toBe(true))
    const resource = worker.posts.at(-1)!
    expect(adapter.calls).toEqual(['asset-a'])
    expect(resource.message).toMatchObject({ type: 'resource-response', data: bytes, mimeType: 'image/png' })
    expect((resource.message as { data: Uint8Array }).data).not.toBe(bytes)
    expect(resource.transfer).toEqual([(resource.message as { data: Uint8Array }).data.buffer])
    const imageBitmap = bitmap()
    worker.emit(result(1, imageBitmap))
    await expect(pending).resolves.toMatchObject({ drawnNodeIds: ['image-a'] })
    expect(visible.context.transferFromImageBitmap).toHaveBeenCalledWith(imageBitmap)
    expect(imageBitmap.close).toHaveBeenCalledOnce()
  })

  it('cancels the previous render and discards its late bitmap', async () => {
    const worker = new TestWorker()
    const visible = canvas()
    const renderer = createThumbnailRenderer({ adapter: new TestAdapter(), workerFactory: { create: () => worker } })
    const first = renderer.render(scene(), visible.target, { width: 100, height: 50 }).catch((error: unknown) => error)
    const second = renderer.render(scene('asset-b'), visible.target, { width: 100, height: 50 })
    await expect(first).resolves.toMatchObject({ name: 'AbortError' })
    expect(worker.posts[1]?.message).toEqual({ type: 'cancel', requestId: 1 })
    const stale = bitmap()
    worker.emit(result(1, stale))
    expect(stale.close).toHaveBeenCalledOnce()
    expect(visible.context.transferFromImageBitmap).not.toHaveBeenCalled()
    worker.emit(result(2))
    await expect(second).resolves.toMatchObject({ drawnNodeIds: ['image-a'] })
  })

  it('converts missing and rejected adapter reads to stable responses', async () => {
    const worker = new TestWorker()
    const adapter = new TestAdapter()
    const renderer = createThumbnailRenderer({ adapter, workerFactory: { create: () => worker } })
    const pending = renderer.render(scene(), canvas().target, { width: 100, height: 50 })
    worker.emit({ type: 'resource-request', requestId: 1, resourceRequestId: 1, assetId: 'missing' })
    await vi.waitFor(() => expect(worker.posts.at(-1)?.message.type).toBe('resource-response'))
    expect(worker.posts.at(-1)?.message).toMatchObject({ error: { code: 'missing-asset', message: 'asset not found' } })
    adapter.error = new Error('storage offline')
    worker.emit({ type: 'resource-request', requestId: 1, resourceRequestId: 2, assetId: 'broken' })
    await vi.waitFor(() => expect(worker.posts.filter((entry) => entry.message.type === 'resource-response')).toHaveLength(2))
    expect(worker.posts.at(-1)?.message).toMatchObject({ error: { code: 'resource-failed', message: 'storage offline' } })
    worker.emit(result(1))
    await pending
  })

  it('rejects presentation and worker failures with a stable code', async () => {
    const worker = new TestWorker()
    const renderer = createThumbnailRenderer({ adapter: new TestAdapter(), workerFactory: { create: () => worker } })
    const unsupported = { getContext: () => null, style: {} } as unknown as HTMLCanvasElement
    await expect(renderer.render(scene(), unsupported, { width: 100, height: 50 })).rejects.toMatchObject({ code: 'worker-failed' })
    expect(worker.posts).toEqual([])
    const pending = renderer.render(scene(), canvas().target, { width: 100, height: 50 })
    worker.fail('worker crashed')
    await expect(pending).rejects.toMatchObject({ code: 'worker-failed', message: 'worker crashed' })
  })

  it('terminates once and never answers resources after disposal', async () => {
    const worker = new TestWorker()
    let resolveAsset: ((data: Uint8Array) => void) | undefined
    const adapter: AssetAdapter = { get: async () => new Promise<Uint8Array>((resolve) => { resolveAsset = resolve }), put: async () => {} }
    const renderer = createThumbnailRenderer({ adapter, workerFactory: { create: () => worker } })
    const pending = renderer.render(scene(), canvas().target, { width: 100, height: 50 }).catch((error: unknown) => error)
    worker.emit({ type: 'resource-request', requestId: 1, resourceRequestId: 1, assetId: 'asset-a' })
    await vi.waitFor(() => expect(resolveAsset).toBeDefined())
    renderer.dispose()
    renderer.dispose()
    resolveAsset!(new Uint8Array([1]))
    await expect(pending).resolves.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    expect(worker.posts.filter((entry) => entry.message.type === 'resource-response')).toEqual([])
    expect(worker.terminateCalls).toBe(1)
    expect(worker.onmessage).toBeNull()
    expect(worker.onerror).toBeNull()
    await expect(renderer.render(scene(), canvas().target, { width: 100, height: 50 })).rejects.toThrow('thumbnail renderer is disposed')
  })
})

// @vitest-environment happy-dom
import { createApp, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SlideNavigator from './SlideNavigator.vue'
import type { ThumbnailWorkerFactory, ThumbnailWorkerPort } from '@ppt4ai/editor'
import type { PlaygroundPresentationSnapshot } from '../presentation-host'

const adapter = { get: async () => undefined, put: async () => {} }
// A no-op worker so ThumbnailCanvas mounts without a real Web Worker (absent in happy-dom).
const workerFactory: ThumbnailWorkerFactory = {
  create(): ThumbnailWorkerPort { return { postMessage() {}, terminate() {}, onmessage: null, onerror: null } },
}
function snap(): PlaygroundPresentationSnapshot {
  const slide = (id: string) => ({ id, title: id, thumbnailScene: { slideId: id, page: { w: 9600, h: 5400 }, nodes: [] }, engineState: {} })
  return { slideOrder: ['sld_1', 'sld_2'], activeSlideId: 'sld_1',
    slides: { sld_1: slide('sld_1'), sld_2: slide('sld_2') },
    presentationHistory: { undoDepth: 0, redoDepth: 0 }, clipboard: { hasContent: false, rootCount: 0, elementCount: 0 }, status: 'idle' } as unknown as PlaygroundPresentationSnapshot
}

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('SlideNavigator', () => {
  it('emits select for a clicked slide and add for the add button', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ canvas: { width: 0, height: 0, style: {} }, save() {}, restore() {}, setTransform() {}, clearRect() {} } as never)
    const events: Array<[string, unknown]> = []
    const el = document.createElement('div'); document.body.append(el)
    createApp({ render: () => h(SlideNavigator, { snapshot: snap(), adapter, workerFactory,
      onSelect: (id: string) => events.push(['select', id]), onAdd: () => events.push(['add', null]) }) }).mount(el)
    ;(el.querySelector('[data-slide-item="sld_2"]') as HTMLElement).click()
    ;(el.querySelector('[data-add-slide]') as HTMLElement).click()
    expect(events).toContainEqual(['select', 'sld_2'])
    expect(events).toContainEqual(['add', null])
  })
})

// @vitest-environment happy-dom
import { createApp, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPpt4aiI18n } from '@ppt4ai/editor'
import Inspector from './Inspector.vue'
import type { PlaygroundPresentationSnapshot } from '../presentation-host'

function snap(selection: string[], elements: Record<string, unknown> = {}): PlaygroundPresentationSnapshot {
  return { slideOrder: ['s'], activeSlideId: 's',
    slides: { s: { id: 's', title: 's', thumbnailScene: { slideId: 's', page: { w: 9600, h: 5400 }, nodes: [] },
      engineState: { selection: new Set(selection), document: { slideOrder: ['s'], slides: { s: {} }, elements, themes: {}, assets: {} }, history: { undoDepth: 0, redoDepth: 0 } } } },
    presentationHistory: { undoDepth: 0, redoDepth: 0 }, clipboard: { hasContent: false, rootCount: 0, elementCount: 0 }, status: 'idle' } as unknown as PlaygroundPresentationSnapshot
}
function mount(props: Record<string, unknown>) {
  const el = document.createElement('div'); document.body.append(el)
  const app = createApp({ render: () => h(Inspector, props as never) })
  app.use(createPpt4aiI18n()); app.mount(el); return el
}
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('Inspector', () => {
  it('shows the slide panel with no selection', () => {
    expect(mount({ snapshot: snap([]), host: {} }).querySelector('[data-inspector="slide"]')).not.toBeNull()
  })
  it('shows object geometry and edits width via the host', () => {
    const host = { resizeElement: vi.fn(() => snap(['e1'])) }
    const el = mount({ snapshot: snap(['e1'], { e1: { id: 'e1', kind: 'shape', bounds: { x: 0, y: 0, w: 100, h: 50 } } }), host })
    expect(el.querySelector('[data-inspector="object"]')).not.toBeNull()
    const w = el.querySelector('[data-geom="w"]') as HTMLInputElement
    w.value = '200'; w.dispatchEvent(new Event('change', { bubbles: true }))
    expect(host.resizeElement).toHaveBeenCalledWith('e1', { x: 0, y: 0, w: 200, h: 50 })
  })
})

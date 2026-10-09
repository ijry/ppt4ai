// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPpt4aiI18n } from '@ppt4ai/editor'
import CanvasStage from './CanvasStage.vue'
import type { PlaygroundPresentationSnapshot } from '../presentation-host'

function snap(selection: string[]): PlaygroundPresentationSnapshot {
  return {
    slideOrder: ['s'], activeSlideId: 's',
    slides: { s: { id: 's', title: 's', thumbnailScene: { slideId: 's', page: { w: 9144000, h: 5143500 }, nodes: [] },
      engineState: { selection, document: { elements: {}, slideOrder: ['s'], slides: { s: {} } }, tableCellSelection: undefined } } },
    presentationHistory: { undoDepth: 0, redoDepth: 0 }, clipboard: { hasContent: false, rootCount: 0, elementCount: 0 }, status: 'idle',
  } as unknown as PlaygroundPresentationSnapshot
}
function context2d(): unknown {
  return { canvas: { width: 0, height: 0, style: {} }, save() {}, restore() {}, setTransform() {}, clearRect() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, ellipse() {}, rect() {}, roundRect() {}, fill() {}, stroke() {}, clip() {}, translate() {}, rotate() {}, scale() {}, setLineDash() {}, fillText() {}, drawImage() {}, fillRect() {}, measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop() {} }) }
}

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('CanvasStage context menu', () => {
  it('opens on right-click with a selection and runs an op', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context2d() as never)
    const host = { adapter: { get: async () => undefined, put: async () => {} }, snapOptions: {}, deleteSelected: vi.fn(() => snap([])) }
    const el = document.createElement('div'); document.body.append(el)
    const app = createApp({ render: () => h(CanvasStage, { snapshot: snap(['e1']), host, zoom: 0.6 } as never) })
    app.use(createPpt4aiI18n()); app.mount(el)

    expect(el.querySelector('[data-context-menu]')).toBeNull()
    el.querySelector('[data-region="stage"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }))
    await nextTick()
    expect(el.querySelector('[data-context-menu]')).not.toBeNull()
    ;(el.querySelector('[data-ctx="delete"]') as HTMLElement).click()
    expect(host.deleteSelected).toHaveBeenCalled()
    await nextTick()
    expect(el.querySelector('[data-context-menu]')).toBeNull() // closes after running
  })

  it('does not open the menu when nothing is selected', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context2d() as never)
    const host = { adapter: { get: async () => undefined, put: async () => {} }, snapOptions: {} }
    const el = document.createElement('div'); document.body.append(el)
    const app = createApp({ render: () => h(CanvasStage, { snapshot: snap([]), host, zoom: 0.6 } as never) })
    app.use(createPpt4aiI18n()); app.mount(el)
    el.querySelector('[data-region="stage"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }))
    await nextTick()
    expect(el.querySelector('[data-context-menu]')).toBeNull()
  })
})

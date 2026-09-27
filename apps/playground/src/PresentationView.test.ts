// @vitest-environment happy-dom
import type { SceneGraph } from '@ppt4ai/render'
import { createApp, h, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PresentationView from './PresentationView.vue'

const adapter = { get: async () => undefined, put: async () => {} }
function scene(id: string): SceneGraph {
  return { slideId: id, page: { w: 9144000, h: 5143500 }, nodes: [] }
}
function ctx(): unknown {
  return { canvas: { width: 0, height: 0, style: {} }, save() {}, restore() {}, setTransform() {}, clearRect() {}, fillRect() {} }
}

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('PresentationView', () => {
  it('navigates slides with arrow keys and exits on Escape', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx() as never)
    let exited = false
    const el = document.createElement('div'); document.body.append(el)
    createApp({ render: () => h(PresentationView, { scenes: [scene('a'), scene('b'), scene('c')], adapter, onExit: () => { exited = true } }) }).mount(el)

    const counter = () => (el.querySelector('[data-presentation]')!.textContent || '').replace(/\s+/g, ' ')
    expect(counter()).toContain('1 / 3')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await nextTick()
    expect(counter()).toContain('2 / 3')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    await nextTick()
    expect(counter()).toContain('1 / 3')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(exited).toBe(true)
  })
})

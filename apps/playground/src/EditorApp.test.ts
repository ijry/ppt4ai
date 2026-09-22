// @vitest-environment happy-dom
import { createApp, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPpt4aiI18n } from '@ppt4ai/editor'
import EditorApp from './EditorApp.vue'

// EditorApp mounts the whole shell (PptEditor, ThumbnailCanvas, SlideBackgroundPanel), which need i18n,
// a Web Worker, and a 2D canvas — none present in happy-dom. Stub just enough for the shell to mount.
function context2d(): unknown {
  return {
    canvas: { width: 0, height: 0, style: {} },
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    bezierCurveTo() {}, quadraticCurveTo() {}, arc() {}, ellipse() {}, rect() {}, roundRect() {},
    fill() {}, stroke() {}, clip() {}, fillRect() {}, clearRect() {}, strokeRect() {},
    translate() {}, rotate() {}, scale() {}, transform() {}, setTransform() {}, resetTransform() {},
    setLineDash() {}, fillText() {}, strokeText() {}, drawImage() {},
    measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({ setTransform() {} }),
  }
}

beforeEach(() => {
  ;(globalThis as unknown as { Worker: unknown }).Worker = class {
    onmessage: unknown = null; onerror: unknown = null
    postMessage() {} terminate() {} addEventListener() {} removeEventListener() {}
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context2d() as never)
  ;(HTMLCanvasElement.prototype as unknown as { transferControlToOffscreen: () => unknown }).transferControlToOffscreen = () => context2d()
})
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('EditorApp', () => {
  it('renders the four regions', () => {
    const el = document.createElement('div'); document.body.append(el)
    const app = createApp({ render: () => h(EditorApp) })
    app.use(createPpt4aiI18n())
    app.mount(el)
    for (const r of ['toolbar', 'navigator', 'stage', 'inspector']) {
      expect(el.querySelector(`[data-region="${r}"]`)).not.toBeNull()
    }
    app.unmount()
  })
})

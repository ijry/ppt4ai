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

async function mountApp() {
  vi.stubGlobal('Worker', TestWorker as unknown as typeof Worker)
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(App)
  app.use(createPpt4aiI18n('zh-CN'))
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  await nextTick()
  return host
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

function slideCanvas(host: HTMLElement): HTMLCanvasElement {
  const canvas = host.querySelector('canvas[data-slide-canvas]')
  if (!canvas) throw new Error('slide canvas is not mounted')
  return canvas as HTMLCanvasElement
}

function fillInput(host: HTMLElement): HTMLInputElement {
  const input = host.querySelector('[data-shape-fill-color]')
  if (!input) throw new Error('shape paint toolbar is not mounted')
  return input as HTMLInputElement
}

function selectedElementText(host: HTMLElement): string {
  return host.querySelector('[data-testid="selected-element"]')?.textContent ?? ''
}

/**
 * Enters `group_demo` and then picks `shape_demo`. The point matters: one CSS pixel is 9525 EMU at
 * zoom 1, and `text_demo` covers y 914400..1371600 while `shape_demo` runs to 2057400 — so a click
 * near y=185px lands on the shape, below the text that would otherwise take the hit.
 */
async function selectSeededShape(host: HTMLElement): Promise<void> {
  const canvas = slideCanvas(host)
  canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 160, clientY: 185, bubbles: true }))
  await nextTick()
  canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 160, clientY: 185, bubbles: true }))
  await nextTick()
}

describe('playground shape paint toolbar wiring', () => {
  it('mounts the toolbar', async () => {
    const host = await mountApp()

    expect(host.querySelector('[data-shape-paint-toolbar]')).not.toBeNull()
  })

  /** A group cannot carry paint, so selecting one has to disable rather than edit a descendant. */
  it('disables the toolbar while a group is selected', async () => {
    const host = await mountApp()
    slideCanvas(host).dispatchEvent(new PointerEvent('pointerdown', { clientX: 140, clientY: 110, bubbles: true }))
    await nextTick()

    expect(selectedElementText(host)).toContain('group_demo')
    expect(fillInput(host).disabled).toBe(true)
  })

  it('enables the toolbar for the shape inside the group', async () => {
    const host = await mountApp()
    await selectSeededShape(host)

    expect(selectedElementText(host)).toContain('shape_demo')
    expect(fillInput(host).disabled).toBe(false)
  })

  /**
   * The assertion that separates "reads the scene" from "reads the element": `shape_demo` is filled
   * with `scheme accent1`, so changing the theme slot changes what the canvas paints while the
   * element's own `fill` field still says `accent1`. Only a scene-derived swatch can follow that.
   *
   * The seed theme is `colors: {}`, and an absent slot resolves to nothing by design — `undefined`
   * means "unknown", `null` means "reset to the Office default" — so the swatch starts at the
   * fallback rather than at 4472C4.
   */
  it('follows a theme colour change rather than the element field', async () => {
    const host = await mountApp()
    await selectSeededShape(host)
    expect(fillInput(host).value.toUpperCase()).toBe('#FFFFFF')

    const accent = host.querySelector('[data-theme-panel] input[data-slot="accent1"]') as HTMLInputElement
    accent.value = '#4472c4'
    accent.dispatchEvent(new Event('change'))
    await nextTick()

    expect(fillInput(host).value.toUpperCase()).toBe('#4472C4')
  })

  it('applies a picked colour through to the toolbar display', async () => {
    const host = await mountApp()
    await selectSeededShape(host)
    const input = fillInput(host)

    input.value = '#ff0000'
    input.dispatchEvent(new Event('change'))
    await nextTick()

    expect(fillInput(host).value.toUpperCase()).toBe('#FF0000')
  })

  it('reports success in the host status after a paint edit', async () => {
    const host = await mountApp()
    await selectSeededShape(host)
    const input = fillInput(host)
    input.value = '#ff0000'
    input.dispatchEvent(new Event('change'))
    await nextTick()

    expect(host.querySelector('[data-testid="asset-status"]')?.textContent ?? '').toContain('fill-updated')
  })

  it('undoes a paint edit through the history toolbar', async () => {
    const host = await mountApp()
    await selectSeededShape(host)
    const input = fillInput(host)
    input.value = '#ff0000'
    input.dispatchEvent(new Event('change'))
    await nextTick()

    ;(host.querySelector('[data-testid="history-undo"]') as HTMLButtonElement).click()
    await nextTick()

    expect(fillInput(host).value.toUpperCase()).toBe('#FFFFFF')
  })
})

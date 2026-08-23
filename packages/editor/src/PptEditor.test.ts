// @vitest-environment happy-dom
import type { AssetAdapter } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import { createApp, h, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPpt4aiI18n, locales } from './i18n'
import PptEditor from './PptEditor.vue'
import type { DecodedImage, ImageDecoder } from './image-canvas-renderer'

const adapter: AssetAdapter = { get: async () => undefined, put: async () => {} }
const scene: SceneGraph = {
  slideId: 'slide-1',
  page: { w: 9144000, h: 5143500 },
  nodes: [{ id: 'shape-1', kind: 'shape', bounds: { x: 914400, y: 914400, w: 1828800, h: 914400 }, path: [] }],
}

function mount(selectedElementId: string | undefined): { app: App; host: HTMLElement } {
  const app = createApp({
    setup() {
      return () => h(PptEditor, {
        scene,
        adapter,
        ...(selectedElementId ? { selectedElementId } : {}),
        decoder: async (): Promise<DecodedImage> => ({ source: {} as CanvasImageSource, width: 1, height: 1 }),
      })
    },
  })
  app.use(createPpt4aiI18n())
  const host = document.createElement('div')
  document.body.append(host)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    canvas: { width: 0, height: 0, style: { width: '', height: '' } },
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  app.mount(host)
  return { app, host }
}

describe('PptEditor', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('renders the controlled slide canvas and eight handles for an existing selection', async () => {
    const mounted = mount('shape-1')
    await nextTick()

    expect(mounted.host.querySelector('[data-slide-canvas]')).toBeTruthy()
    expect(mounted.host.querySelector('[data-selection-overlay]')).toBeTruthy()
    expect(mounted.host.querySelectorAll('[data-selection-handle]')).toHaveLength(8)
    expect(mounted.host.querySelector('[data-selection-border]')?.getAttribute('style')).toContain('left: 96px')
    mounted.app.unmount()
  })

  it('does not render a selection overlay for an unknown or empty selection', async () => {
    const mounted = mount('missing')
    await nextTick()
    expect(mounted.host.querySelector('[data-selection-overlay]')).toBeNull()
    mounted.app.unmount()
  })

  it('keeps localized editor keys symmetric', () => {
    const flatten = (value: Record<string, unknown>, prefix = ''): string[] => Object.entries(value).flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key
      return typeof child === 'string' ? [path] : flatten(child as Record<string, unknown>, path)
    })
    expect(flatten(locales['zh-CN'])).toEqual(flatten(locales['en-US']))
  })
})

// @vitest-environment happy-dom
import { createApp, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPpt4aiI18n } from '@ppt4ai/editor'
import { PAINTED_PRESET_PATTERNS } from '@ppt4ai/model'
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

  it('shows fill/stroke for a selected shape and writes srgb on change', () => {
    const host = { setSelectedFill: vi.fn(() => snap(['e1'])) }
    const el = mount({ snapshot: snap(['e1'], { e1: { id: 'e1', kind: 'shape', bounds: { x: 0, y: 0, w: 100, h: 50 }, fill: { color: { type: 'srgb', v: 'FF0000' } } } }), host })
    const fill = el.querySelector('[data-fill]') as HTMLInputElement
    expect(fill.value).toBe('#ff0000')
    fill.value = '#00ff00'; fill.dispatchEvent(new Event('input', { bubbles: true }))
    expect(host.setSelectedFill).toHaveBeenCalledWith({ color: { type: 'srgb', v: '00FF00' } })
  })

  it('switches a solid fill to a gradient (current colour → white by default)', () => {
    const host = { setSelectedFill: vi.fn(() => snap(['e1'])) }
    const el = mount({ snapshot: snap(['e1'], { e1: { id: 'e1', kind: 'shape', bounds: { x: 0, y: 0, w: 100, h: 50 }, fill: { color: { type: 'srgb', v: 'FF0000' } } } }), host })
    const kind = el.querySelector('[data-fill-kind]') as HTMLSelectElement
    expect(kind.value).toBe('solid')
    kind.value = 'gradient'; kind.dispatchEvent(new Event('change', { bubbles: true }))
    expect(host.setSelectedFill).toHaveBeenCalledWith({
      color: { type: 'srgb', v: 'FF0000' },
      gradient: { stops: [{ pos: 0, color: { type: 'srgb', v: 'FF0000' } }, { pos: 100000, color: { type: 'srgb', v: 'FFFFFF' } }], angle: 0 },
    })
  })

  it('reflects an existing gradient fill and edits its angle', () => {
    const host = { setSelectedFill: vi.fn(() => snap(['e1'])) }
    const gradient = { stops: [{ pos: 0, color: { type: 'srgb', v: '112233' } }, { pos: 100000, color: { type: 'srgb', v: 'AABBCC' } }], angle: 5400000 }
    const el = mount({ snapshot: snap(['e1'], { e1: { id: 'e1', kind: 'shape', bounds: { x: 0, y: 0, w: 100, h: 50 }, fill: { color: { type: 'srgb', v: '112233' }, gradient } } }), host })
    expect((el.querySelector('[data-fill-kind]') as HTMLSelectElement).value).toBe('gradient')
    expect((el.querySelector('[data-gradient-start]') as HTMLInputElement).value).toBe('#112233')
    expect((el.querySelector('[data-gradient-end]') as HTMLInputElement).value).toBe('#aabbcc')
    const angle = el.querySelector('[data-gradient-angle]') as HTMLInputElement
    expect(angle.value).toBe('90')
    angle.value = '45'; angle.dispatchEvent(new Event('change', { bubbles: true }))
    expect(host.setSelectedFill).toHaveBeenCalledWith({
      color: { type: 'srgb', v: '112233' },
      gradient: { stops: [{ pos: 0, color: { type: 'srgb', v: '112233' } }, { pos: 100000, color: { type: 'srgb', v: 'AABBCC' } }], angle: 2700000 },
    })
  })

  it('switches a solid fill to a pattern (current colour on white by default)', () => {
    const host = { setSelectedFill: vi.fn(() => snap(['e1'])) }
    const el = mount({ snapshot: snap(['e1'], { e1: { id: 'e1', kind: 'shape', bounds: { x: 0, y: 0, w: 100, h: 50 }, fill: { color: { type: 'srgb', v: 'FF0000' } } } }), host })
    const kind = el.querySelector('[data-fill-kind]') as HTMLSelectElement
    kind.value = 'pattern'; kind.dispatchEvent(new Event('change', { bubbles: true }))
    expect(host.setSelectedFill).toHaveBeenCalledWith({
      color: { type: 'srgb', v: 'FF0000' },
      pattern: { preset: PAINTED_PRESET_PATTERNS[0], foreground: { type: 'srgb', v: 'FF0000' }, background: { type: 'srgb', v: 'FFFFFF' } },
    })
  })

  it('reflects an existing pattern fill and edits its preset', () => {
    const host = { setSelectedFill: vi.fn(() => snap(['e1'])) }
    const pattern = { preset: 'vert', foreground: { type: 'srgb', v: '112233' }, background: { type: 'srgb', v: 'AABBCC' } }
    const el = mount({ snapshot: snap(['e1'], { e1: { id: 'e1', kind: 'shape', bounds: { x: 0, y: 0, w: 100, h: 50 }, fill: { color: { type: 'srgb', v: '112233' }, pattern } } }), host })
    expect((el.querySelector('[data-fill-kind]') as HTMLSelectElement).value).toBe('pattern')
    expect((el.querySelector('[data-pattern-foreground]') as HTMLInputElement).value).toBe('#112233')
    expect((el.querySelector('[data-pattern-background]') as HTMLInputElement).value).toBe('#aabbcc')
    const preset = el.querySelector('[data-pattern-preset]') as HTMLSelectElement
    expect(preset.value).toBe('vert')
    preset.value = 'horz'; preset.dispatchEvent(new Event('change', { bubbles: true }))
    expect(host.setSelectedFill).toHaveBeenCalledWith({
      color: { type: 'srgb', v: '112233' },
      pattern: { preset: 'horz', foreground: { type: 'srgb', v: '112233' }, background: { type: 'srgb', v: 'AABBCC' } },
    })
  })

  it('edits stroke width (pt→EMU) and line style for a selected shape', () => {
    const host = { setSelectedStrokeWidth: vi.fn(() => snap(['e1'])), setSelectedStrokeStyle: vi.fn(() => snap(['e1'])) }
    const el = mount({ snapshot: snap(['e1'], { e1: { id: 'e1', kind: 'shape', bounds: { x: 0, y: 0, w: 100, h: 50 }, strokeWidth: 12700, strokeStyle: 'solid' } }), host })
    const width = el.querySelector('[data-stroke-width]') as HTMLInputElement
    expect(width.value).toBe('1')
    width.value = '2'; width.dispatchEvent(new Event('change', { bubbles: true }))
    expect(host.setSelectedStrokeWidth).toHaveBeenCalledWith(25400)
    const style = el.querySelector('[data-stroke-style]') as HTMLSelectElement
    style.value = 'dash'; style.dispatchEvent(new Event('change', { bubbles: true }))
    expect(host.setSelectedStrokeStyle).toHaveBeenCalledWith('dash')
  })
  it('shows a layout picker and switches layout via the host', () => {
    const host = { setSlideLayout: vi.fn(() => snap([])) }
    const s = snap([])
    const doc = (s.slides.s as unknown as { engineState: { document: Record<string, unknown> } }).engineState.document
    doc.layouts = { lyt_1: { id: 'lyt_1', masterId: 'mst_1' }, lyt_2: { id: 'lyt_2', masterId: 'mst_1' } }
    doc.slides = { s: { layoutId: 'lyt_1', masterId: 'mst_1' } }
    const el = mount({ snapshot: s, host })
    const picker = el.querySelector('[data-layout-picker]') as HTMLSelectElement
    expect(picker).not.toBeNull()
    picker.value = 'lyt_2'; picker.dispatchEvent(new Event('change', { bubbles: true }))
    expect(host.setSlideLayout).toHaveBeenCalledWith('lyt_2')
  })
  it('renders the theme panel when the slide resolves a theme', () => {
    const s = snap([])
    const doc = (s.slides.s as unknown as { engineState: { document: Record<string, unknown> } }).engineState.document
    doc.slides = { s: { layoutId: 'lyt_1' } }
    doc.layouts = { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } }
    doc.masters = { mst_1: { id: 'mst_1', themeId: 'theme_1' } }
    doc.themes = { theme_1: { id: 'theme_1', colors: {}, fonts: {} } }
    expect(mount({ snapshot: s, host: {} }).querySelector('[data-theme-panel]')).not.toBeNull()
  })
})

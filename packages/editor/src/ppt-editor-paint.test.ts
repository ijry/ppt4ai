// @vitest-environment happy-dom
import type { AssetAdapter } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import { createApp, h, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { createPpt4aiI18n } from './i18n'
import PptEditor from './PptEditor.vue'

const adapter: AssetAdapter = { get: async () => undefined, put: async () => {} }

const bounds = { x: 914400, y: 914400, w: 1828800, h: 914400 }

const scene: SceneGraph = {
  slideId: 'slide-1',
  page: { w: 9144000, h: 5143500 },
  nodes: [
    {
      id: 'shape-1',
      kind: 'shape',
      bounds,
      path: [],
      resolvedFillColor: { rgb: '4472C4', alpha: 100000 },
      resolvedStrokeColor: { rgb: '203864', alpha: 100000 },
      strokeWidth: 12700,
      strokeStyle: 'dash',
    },
    {
      id: 'graded-1',
      kind: 'shape',
      bounds: { x: 3657600, y: 914400, w: 914400, h: 914400 },
      path: [],
      resolvedFillColor: { rgb: '4472C4', alpha: 100000 },
      resolvedFillGradient: {
        stops: [
          { pos: 0, color: { rgb: '4472C4', alpha: 100000 } },
          { pos: 100000, color: { rgb: 'ED7D31', alpha: 100000 } },
        ],
      },
    },
    { id: 'image-1', kind: 'image', bounds: { x: 0, y: 2743200, w: 914400, h: 914400 }, assetId: 'asset-1' },
  ],
}

const mounted: App[] = []

interface Events {
  fills: unknown[]
  widths: unknown[]
  styles: unknown[]
}

function mountEditor(selectedElementIds: string[]) {
  const events: Events = { fills: [], widths: [], styles: [] }
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup: () => () => h(PptEditor, {
      scene,
      adapter,
      selectedElementIds,
      'onSet-fill': (fill: unknown) => { events.fills.push(fill) },
      'onSet-stroke-width': (width: unknown) => { events.widths.push(width) },
      'onSet-stroke-style': (style: unknown) => { events.styles.push(style) },
    }),
  })
  app.use(createPpt4aiI18n())
  app.mount(host)
  mounted.push(app)
  return { host, events }
}

afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

function fillInput(host: HTMLElement): HTMLInputElement {
  const input = host.querySelector('[data-shape-fill-color]')
  if (!input) throw new Error('paint toolbar is not mounted')
  return input as HTMLInputElement
}

/**
 * The first formatting toolbar to live inside the editor. `PptEditor` stays presentational: it reads
 * the scene node and emits intents, and the host turns those into commands, the same split resize
 * and rotation already use.
 */
describe('PptEditor paint toolbar', () => {
  it('mounts the toolbar in the editor toolbar row', () => {
    const { host } = mountEditor([])

    expect(host.querySelector('#ppt-editor-toolbar [data-shape-paint-toolbar]')).not.toBeNull()
  })

  it('disables the toolbar with no selection', () => {
    const { host } = mountEditor([])

    expect(fillInput(host).disabled).toBe(true)
  })

  /** The paint commands are element-scoped, so a multi-selection has to disable. */
  it('disables the toolbar for a multi-selection', () => {
    const { host } = mountEditor(['shape-1', 'graded-1'])

    expect(fillInput(host).disabled).toBe(true)
  })

  it('disables the toolbar for a kind that cannot carry paint', () => {
    const { host } = mountEditor(['image-1'])

    expect(fillInput(host).disabled).toBe(true)
  })

  /** Values come from the scene node, which already merged the theme fallbacks. */
  it('shows the resolved paint of a single selected shape', () => {
    const { host } = mountEditor(['shape-1'])

    expect(fillInput(host).disabled).toBe(false)
    expect(fillInput(host).value.toUpperCase()).toBe('#4472C4')
    expect((host.querySelector('[data-shape-stroke-color]') as HTMLInputElement).value.toUpperCase()).toBe('#203864')
    expect((host.querySelector('[data-shape-stroke-width]') as HTMLInputElement).value).toBe('1')
    expect((host.querySelector('[data-shape-stroke-style]') as HTMLSelectElement).value).toBe('dash')
  })

  it('marks a gradient fill rather than claiming its first stop', () => {
    const { host } = mountEditor(['graded-1'])

    expect(host.querySelector('[data-shape-fill-gradient]')).not.toBeNull()
  })

  it('forwards each toolbar change as an editor emit', () => {
    const { host, events } = mountEditor(['shape-1'])

    const fill = fillInput(host)
    fill.value = '#ff0000'
    fill.dispatchEvent(new Event('change'))

    const width = host.querySelector('[data-shape-stroke-width]') as HTMLInputElement
    width.value = '6'
    width.dispatchEvent(new Event('input'))
    width.dispatchEvent(new Event('change'))

    const style = host.querySelector('[data-shape-stroke-style]') as HTMLSelectElement
    style.value = 'dot'
    style.dispatchEvent(new Event('change'))

    expect(events.fills).toEqual([{ color: { type: 'srgb', v: 'FF0000' } }])
    expect(events.widths).toEqual([76200])
    expect(events.styles).toEqual(['dot'])
  })

  it('forwards a clear as null', () => {
    const { host, events } = mountEditor(['shape-1'])

    ;(host.querySelector('[data-action="clear-fill"]') as HTMLButtonElement).click()

    expect(events.fills).toEqual([null])
  })
})

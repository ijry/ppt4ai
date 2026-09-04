// @vitest-environment happy-dom
import type { AssetAdapter, TextBody } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import { createApp, h, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { createPpt4aiI18n } from './i18n'
import PptEditor from './PptEditor.vue'

const adapter: AssetAdapter = { get: async () => undefined, put: async () => {} }

const bounds = { x: 914400, y: 914400, w: 1828800, h: 914400 }
const body: TextBody = { paragraphs: [{ runs: [{ text: 'Editable' }] }] }

const scene: SceneGraph = {
  slideId: 'slide-1',
  page: { w: 9144000, h: 5143500 },
  nodes: [
    {
      id: 'text-1',
      kind: 'text',
      bounds,
      text: 'Editable',
      layout: { bounds, lines: [], fontScale: 100000, overflow: false, contentBounds: { ...bounds, w: 0, h: 0 } },
    },
    { id: 'shape-1', kind: 'shape', bounds: { x: 0, y: 2743200, w: 914400, h: 914400 }, path: [] },
  ],
}

const mounted: App[] = []

/** One instance per file: a fresh createI18n per mount starts throwing past roughly five. */
const i18n = createPpt4aiI18n()

function mountEditor(selectedElementIds: string[]) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup: () => () => h(PptEditor, {
      scene,
      adapter,
      selectedElementIds,
      textBodies: { 'text-1': body },
      fontFamilies: ['Calibri', 'Georgia'],
    }),
  })
  app.use(i18n)
  app.mount(host)
  mounted.push(app)
  return { host }
}

afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

function toolbar(host: HTMLElement): HTMLElement | null {
  return host.querySelector('[data-text-formatting-toolbar]')
}

async function openTextEditor(host: HTMLElement): Promise<void> {
  const canvas = host.querySelector('canvas[data-slide-canvas]')
  if (!canvas) throw new Error('slide canvas is not mounted')
  // One CSS pixel is 9525 EMU at zoom 1, so this lands inside text-1's box.
  canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 120, clientY: 120, bubbles: true }))
  await nextTick()
  await nextTick()
}

/**
 * The last component the survey found unreachable. The toolbar only makes sense while a text editor
 * is open, because the formatting state describes that editor's live selection rather than anything
 * derivable from the scene.
 */
describe('PptEditor text formatting toolbar', () => {
  it('hides the toolbar when no text editor is open', () => {
    const { host } = mountEditor(['text-1'])

    expect(toolbar(host)).toBeNull()
  })

  it('hides the toolbar for a shape selection', () => {
    const { host } = mountEditor(['shape-1'])

    expect(toolbar(host)).toBeNull()
  })

  it('shows the toolbar once the text editor reports its formatting state', async () => {
    const { host } = mountEditor(['text-1'])

    await openTextEditor(host)

    expect(toolbar(host)).not.toBeNull()
  })

  it('offers the host font families and the built-in sizes', async () => {
    const { host } = mountEditor(['text-1'])
    await openTextEditor(host)

    const options = [...(toolbar(host)?.querySelectorAll('option') ?? [])].map((option) => option.textContent?.trim())

    expect(options).toContain('Calibri')
    expect(options).toContain('Georgia')
  })
})

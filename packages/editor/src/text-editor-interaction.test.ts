// @vitest-environment happy-dom
import type { TextBody } from '@ppt4ai/model'
import { layoutText, textBodyToProseMirror } from '@ppt4ai/text'
import { createApp, h } from 'vue'
import { describe, expect, it } from 'vitest'
import TextEditorOverlay from './TextEditorOverlay.vue'
import { createTextInteraction, layoutRectToScreen, screenPointToLayout } from './text-editor-interaction'

const body: TextBody = { paragraphs: [{ runs: [{ text: '中文测试' }] }] }
const document = textBodyToProseMirror(body)
const layout = layoutText({ bounds: { x: 0, y: 0, w: 500000, h: 1000000 }, body })
const transform = { originX: 20, originY: 30, scale: 2 / 9525 }

describe('text editor interaction', () => {
  it('converts layout rectangles and points through one viewport transform', () => {
    expect(layoutRectToScreen({ x: 9525, y: 19050, width: 1, height: 9525 }, transform)).toEqual({
      x: 22,
      y: 34,
      width: 1,
      height: 2,
    })
    expect(screenPointToLayout({ x: 22, y: 34 }, transform)).toEqual({ x: 9525, y: 19050 })
  })

  it('creates screen caret and reverse selection geometry', () => {
    const interaction = createTextInteraction(layout, document, { anchor: 5, head: 2 }, transform)
    expect(interaction.selection.length).toBeGreaterThan(1)
    expect(interaction.selection.every((rect) => rect.width > 0 && rect.height > 0)).toBe(true)
    expect(interaction.caret.width).toBe(1)
  })

  it('renders a caret and selection rectangles while active', () => {
    const host = documentOwner().createElement('div')
    documentOwner().body.append(host)
    const interaction = createTextInteraction(layout, document, { anchor: 5, head: 2 }, transform)
    const app = createApp({ setup: () => () => h(TextEditorOverlay, { active: true, ...interaction }) })
    app.mount(host)

    expect(host.querySelectorAll('[data-text-caret]')).toHaveLength(1)
    expect(host.querySelectorAll('[data-text-selection]')).toHaveLength(interaction.selection.length)
    app.unmount()
    host.remove()
  })

  it('renders nothing while inactive', () => {
    const host = documentOwner().createElement('div')
    documentOwner().body.append(host)
    const app = createApp({ setup: () => () => h(TextEditorOverlay, { active: false, caret: { x: 0, y: 0, width: 1, height: 10 }, selection: [] }) })
    app.mount(host)
    expect(host.querySelector('[data-text-editor-overlay]')).toBeNull()
    app.unmount()
    host.remove()
  })
})

function documentOwner(): Document {
  return globalThis.document
}

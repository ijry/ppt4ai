// @vitest-environment happy-dom

import type { TextFormattingState } from '@ppt4ai/text'
import { createApp, h } from 'vue'
import { describe, expect, it } from 'vitest'
import TextFormattingToolbar from './TextFormattingToolbar.vue'
import { createPpt4aiI18n } from './i18n'

const state: TextFormattingState = {
  bold: 'mixed',
  italic: false,
  underline: true,
  align: 'center',
}

function mountToolbar(active: boolean) {
  const events: { marks: unknown[]; toggles: unknown[]; alignments: unknown[] } = { marks: [], toggles: [], alignments: [] }
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup: () => () => h(TextFormattingToolbar, {
      active,
      state,
      fontFamilies: ['Arial', 'Calibri'],
      fontSizes: [12, 18],
      'onSet-marks': (patch: unknown) => events.marks.push(patch),
      'onToggle-mark': (name: unknown) => events.toggles.push(name),
      'onSet-alignment': (align: unknown) => events.alignments.push(align),
    }),
  })
  app.use(createPpt4aiI18n())
  app.mount(host)
  return { app, host, events }
}

describe('TextFormattingToolbar', () => {
  it('renders semantic controls, mixed state, and inactive disabled state', () => {
    const { app, host } = mountToolbar(false)

    expect(host.querySelectorAll('button')).toHaveLength(6)
    expect(host.querySelectorAll('select')).toHaveLength(2)
    expect(host.querySelector('input[type="color"]')).not.toBeNull()
    expect(host.querySelector('button[aria-pressed="mixed"]')).not.toBeNull()
    expect(host.querySelectorAll('button:disabled')).toHaveLength(6)
    expect(host.querySelectorAll('select:disabled')).toHaveLength(2)
    expect((host.querySelector('input[type="color"]') as HTMLInputElement).disabled).toBe(true)
    expect(host.querySelector('select')?.querySelector('option[value=""]')).not.toBeNull()
    expect(host.querySelector('[data-text-formatting-toolbar]')?.className).toContain('flex')
    expect(host.textContent).not.toContain('Hello')

    app.unmount()
    host.remove()
  })

  it('emits typed mark, alignment, font, size, and color commands', () => {
    const { app, host, events } = mountToolbar(true)
    const buttons = [...host.querySelectorAll('button')] as HTMLButtonElement[]
    buttons[0]?.click()
    buttons[3]?.click()
    const selects = [...host.querySelectorAll('select')] as HTMLSelectElement[]
    selects[0]!.value = 'Arial'
    selects[0]!.dispatchEvent(new Event('change', { bubbles: true }))
    selects[1]!.value = '18'
    selects[1]!.dispatchEvent(new Event('change', { bubbles: true }))
    const color = host.querySelector('input[type="color"]') as HTMLInputElement
    color.value = '#00ff00'
    color.dispatchEvent(new Event('change', { bubbles: true }))

    expect(events.toggles).toEqual(['bold'])
    expect(events.alignments).toEqual(['left'])
    expect(events.marks).toEqual([
      { fontFamily: 'Arial' },
      { fontSize: 18 },
      { color: { color: { type: 'srgb', v: '00ff00' } } },
    ])

    app.unmount()
    host.remove()
  })
})

// @vitest-environment happy-dom

import type { TextFormattingState } from '@ppt4ai/text'
import { createApp, h } from 'vue'
import { describe, expect, it } from 'vitest'
import TextFormattingToolbar from './TextFormattingToolbar.vue'
import { createPpt4aiI18n } from './i18n'

function mountToolbar(options: {
  state: TextFormattingState
  fontFamilies: readonly string[]
  eaFontFamilies?: readonly string[]
}) {
  const marks: unknown[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup: () => () => h(TextFormattingToolbar, {
      active: true,
      state: options.state,
      fontFamilies: options.fontFamilies,
      ...(options.eaFontFamilies ? { eaFontFamilies: options.eaFontFamilies } : {}),
      fontSizes: [12, 18],
      'onSet-marks': (patch: unknown) => { marks.push(patch) },
    }),
  })
  app.use(createPpt4aiI18n())
  app.mount(host)
  return { app, host, marks }
}

const plain: TextFormattingState = { bold: false, italic: false, underline: false }

function optionsOf(select: Element): string[] {
  return [...select.querySelectorAll('option')].map((option) => option.getAttribute('value') ?? '')
}

describe('east asian typeface control', () => {
  it('offers the east asian list the host gave, separately from the latin one', () => {
    const { app, host } = mountToolbar({
      state: plain,
      fontFamilies: ['Arial', 'Calibri'],
      eaFontFamilies: ['宋体', '黑体'],
    })
    const selects = [...host.querySelectorAll('select')]

    expect(optionsOf(selects[0]!)).toEqual(['', 'Arial', 'Calibri'])
    expect(optionsOf(selects[1]!)).toEqual(['', '宋体', '黑体'])

    app.unmount()
    host.remove()
  })

  /** The default configuration gives one list; the control has to work rather than vanish. */
  it('falls back to the latin list when the host gave only one', () => {
    const { app, host } = mountToolbar({ state: plain, fontFamilies: ['Arial', 'Calibri'] })
    const selects = [...host.querySelectorAll('select')]

    expect(optionsOf(selects[1]!)).toEqual(['', 'Arial', 'Calibri'])

    app.unmount()
    host.remove()
  })

  it('shows the current east asian typeface', () => {
    const { app, host } = mountToolbar({
      state: { ...plain, fontFamily: 'Calibri', fontFamilyEa: '黑体' },
      fontFamilies: ['Arial', 'Calibri'],
      eaFontFamilies: ['宋体', '黑体'],
    })
    const selects = [...host.querySelectorAll('select')] as HTMLSelectElement[]

    expect(selects[0]!.value).toBe('Calibri')
    expect(selects[1]!.value).toBe('黑体')

    app.unmount()
    host.remove()
  })

  /** A selection whose runs disagree leaves the state value absent, and the placeholder shows instead. */
  it('shows the mixed placeholder when the selection disagrees', () => {
    const { app, host } = mountToolbar({
      state: plain,
      fontFamilies: ['Arial'],
      eaFontFamilies: ['宋体', '黑体'],
    })
    const selects = [...host.querySelectorAll('select')] as HTMLSelectElement[]

    expect(selects[1]!.value).toBe('')

    app.unmount()
    host.remove()
  })

  it('labels the two typeface controls differently', () => {
    const { app, host } = mountToolbar({ state: plain, fontFamilies: ['Arial'] })
    const labels = [...host.querySelectorAll('select')].map((select) => select.getAttribute('aria-label'))

    expect(new Set(labels).size).toBe(labels.length)

    app.unmount()
    host.remove()
  })

  it('emits the east asian patch on change', () => {
    const { app, host, marks } = mountToolbar({
      state: plain,
      fontFamilies: ['Arial'],
      eaFontFamilies: ['宋体'],
    })
    const select = [...host.querySelectorAll('select')][1] as HTMLSelectElement
    select.value = '宋体'
    select.dispatchEvent(new Event('change', { bubbles: true }))

    expect(marks).toEqual([{ fontFamilyEa: '宋体' }])

    app.unmount()
    host.remove()
  })
})

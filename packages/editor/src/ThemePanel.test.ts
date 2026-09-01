// @vitest-environment happy-dom

import { createApp, h } from 'vue'
import { describe, expect, it } from 'vitest'
import type { ThemePanelSlotModel } from './theme-panel'
import ThemePanel from './ThemePanel.vue'
import { createPpt4aiI18n } from './i18n'

const slots: ThemePanelSlotModel[] = [
  { slot: 'dk1', group: 'neutral', color: '#000000', isDefault: false, inherited: true },
  { slot: 'accent1', group: 'accent', color: '#FF0000', isDefault: false, inherited: false },
  { slot: 'hlink', group: 'hyperlink', color: '#0563C1', isDefault: true, inherited: false },
]

function mountPanel(active: boolean) {
  const events: { colors: unknown[]; resets: unknown[] } = { colors: [], resets: [] }
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup: () => () => h(ThemePanel, {
      active,
      slots,
      'onSet-color': (slot: unknown, color: unknown) => events.colors.push([slot, color]),
      'onReset-color': (slot: unknown) => events.resets.push(slot),
    }),
  })
  app.use(createPpt4aiI18n('en-US'))
  app.mount(host)
  return { app, host, events }
}

describe('ThemePanel', () => {
  it('renders one color input and reset button per slot with group sections', () => {
    const { app, host } = mountPanel(true)

    expect(host.querySelectorAll('input[type="color"]')).toHaveLength(3)
    expect(host.querySelectorAll('button[data-action="reset-slot"]')).toHaveLength(3)
    expect(host.querySelectorAll('[data-slot-group]')).toHaveLength(3)
    expect((host.querySelector('input[data-slot="accent1"]') as HTMLInputElement).value).toBe('#ff0000')
    expect(host.querySelector('[data-slot-row="dk1"]')?.getAttribute('data-inherited')).toBe('true')
    expect(host.querySelector('[data-slot-row="hlink"]')?.getAttribute('data-inherited')).toBe('false')

    app.unmount()
    host.remove()
  })

  it('disables every control when inactive', () => {
    const { app, host } = mountPanel(false)

    expect(host.querySelectorAll('input:disabled')).toHaveLength(3)
    expect(host.querySelectorAll('button:disabled')).toHaveLength(3)

    app.unmount()
    host.remove()
  })

  it('emits parsed colors on change and the slot on reset', () => {
    const { app, host, events } = mountPanel(true)
    const input = host.querySelector('input[data-slot="accent1"]') as HTMLInputElement
    input.value = '#00ff00'
    input.dispatchEvent(new Event('change'))
    ;(host.querySelector('button[data-slot="hlink"]') as HTMLButtonElement).click()

    expect(events.colors).toEqual([['accent1', { type: 'srgb', v: '00FF00' }]])
    expect(events.resets).toEqual(['hlink'])

    app.unmount()
    host.remove()
  })

  it('emits nothing when the input yields no parsable color', () => {
    const { app, host, events } = mountPanel(true)
    const input = host.querySelector('input[data-slot="dk1"]') as HTMLInputElement
    Object.defineProperty(input, 'value', { value: '', configurable: true })
    input.dispatchEvent(new Event('change'))

    expect(events.colors).toEqual([])

    app.unmount()
    host.remove()
  })
})

// @vitest-environment happy-dom

import { createApp, h } from 'vue'
import { describe, expect, it } from 'vitest'
import type { ThemePanelFontModel, ThemePanelSlotModel } from './theme-panel'
import ThemePanel from './ThemePanel.vue'
import { createPpt4aiI18n } from './i18n'

const slots: ThemePanelSlotModel[] = [
  { slot: 'dk1', group: 'neutral', color: '#000000', isDefault: false, inherited: true },
  { slot: 'accent1', group: 'accent', color: '#FF0000', isDefault: false, inherited: false },
  { slot: 'hlink', group: 'hyperlink', color: '#0563C1', isDefault: true, inherited: false },
]

const fonts: ThemePanelFontModel[] = [
  { slot: 'major', script: 'latin', typeface: 'Cambria', isDefault: false, inherited: false },
  { slot: 'major', script: 'ea', typeface: '', isDefault: false, inherited: true },
  { slot: 'major', script: 'cs', typeface: '', isDefault: false, inherited: true },
  { slot: 'minor', script: 'latin', typeface: 'Aptos', isDefault: true, inherited: false },
  { slot: 'minor', script: 'ea', typeface: '等线', isDefault: false, inherited: false },
  { slot: 'minor', script: 'cs', typeface: '', isDefault: false, inherited: true },
]

const fontFamilies = ['Aptos', 'Cambria', '宋体']

interface PanelEvents {
  colors: unknown[]
  resets: unknown[]
  fonts: unknown[]
  fontResets: unknown[]
}

function mountPanel(active: boolean) {
  const events: PanelEvents = { colors: [], resets: [], fonts: [], fontResets: [] }
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup: () => () => h(ThemePanel, {
      active,
      slots,
      fonts,
      fontFamilies,
      'onSet-color': (slot: unknown, color: unknown) => events.colors.push([slot, color]),
      'onReset-color': (slot: unknown) => events.resets.push(slot),
      'onSet-font': (slot: unknown, script: unknown, typeface: unknown) => events.fonts.push([slot, script, typeface]),
      'onReset-font': (slot: unknown, script: unknown) => events.fontResets.push([slot, script]),
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

    expect(host.querySelectorAll('input:disabled')).toHaveLength(9)
    expect(host.querySelectorAll('button:disabled')).toHaveLength(9)

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

  it('renders one font box and reset button per slot and script', () => {
    const { app, host } = mountPanel(true)
    const familyList = host.querySelector('datalist')

    expect(host.querySelectorAll('input[type="text"][data-font]')).toHaveLength(6)
    expect(host.querySelectorAll('button[data-action="reset-font"]')).toHaveLength(6)
    expect(host.querySelectorAll('[data-font-group]')).toHaveLength(2)
    expect([...familyList?.querySelectorAll('option') ?? []].map((option) => option.getAttribute('value'))).toEqual(fontFamilies)
    expect(host.querySelector('input[data-font="major-latin"]')?.getAttribute('list')).toBe(familyList?.id)
    // An empty box is the truth for an unset ea/cs: the stock theme leaves those typefaces empty.
    expect((host.querySelector('input[data-font="major-ea"]') as HTMLInputElement).value).toBe('')
    expect((host.querySelector('input[data-font="minor-ea"]') as HTMLInputElement).value).toBe('等线')
    expect(host.querySelector('[data-font-row="major-ea"]')?.getAttribute('data-inherited')).toBe('true')
    expect(host.querySelector('[data-font-row="minor-latin"]')?.getAttribute('data-inherited')).toBe('false')

    app.unmount()
    host.remove()
  })

  it('emits the trimmed typeface on change and the row on reset', () => {
    const { app, host, events } = mountPanel(true)
    const input = host.querySelector('input[data-font="major-latin"]') as HTMLInputElement
    input.value = '  Georgia  '
    input.dispatchEvent(new Event('change'))
    ;(host.querySelector('button[data-action="reset-font"][data-font="minor-ea"]') as HTMLButtonElement).click()

    expect(events.fonts).toEqual([['major', 'latin', 'Georgia']])
    expect(events.fontResets).toEqual([['minor', 'ea']])

    app.unmount()
    host.remove()
  })

  /** Clearing the box is not a typeface; the reset button is how a row goes back to the default. */
  it('emits nothing when a font box is cleared', () => {
    const { app, host, events } = mountPanel(true)
    const input = host.querySelector('input[data-font="major-latin"]') as HTMLInputElement
    input.value = '   '
    input.dispatchEvent(new Event('change'))

    expect(events.fonts).toEqual([])

    app.unmount()
    host.remove()
  })
})

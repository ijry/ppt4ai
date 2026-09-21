// @vitest-environment happy-dom

import { createApp, h } from 'vue'
import { describe, expect, it } from 'vitest'
import TableFormattingToolbar from './TableFormattingToolbar.vue'
import { createPpt4aiI18n } from './i18n'

function mountToolbar(active: boolean) {
  const events: { fills: unknown[]; borders: unknown[] } = { fills: [], borders: [] }
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup: () => () => h(TableFormattingToolbar, {
      active,
      fillColor: '#ffffff',
      borderColor: '#000000',
      borderWidth: 12700,
      borderStyle: 'solid',
      borderSides: [],
      'onSet-fill': (fill: unknown) => events.fills.push(fill),
      'onSet-borders': (borders: unknown) => events.borders.push(borders),
    }),
  })
  app.use(createPpt4aiI18n())
  app.mount(host)
  return { app, host, events }
}

describe('TableFormattingToolbar', () => {
  it('renders semantic controls and disables them when inactive', () => {
    const { app, host } = mountToolbar(false)

    expect(host.querySelectorAll('button')).toHaveLength(7)
    expect(host.querySelectorAll('select')).toHaveLength(3)
    expect(host.querySelectorAll('input[type="color"]')).toHaveLength(6)
    expect(host.querySelectorAll('button:disabled')).toHaveLength(7)
    expect(host.querySelectorAll('select:disabled')).toHaveLength(3)
    expect(host.querySelectorAll('input:disabled')).toHaveLength(7)
    expect(host.querySelector('[data-table-formatting-toolbar]')?.className).toContain('flex')

    app.unmount()
    host.remove()
  })

  it('emits normalized fill and selected border commands', () => {
    const { app, host, events } = mountToolbar(true)
    const colors = [...host.querySelectorAll('input[type="color"]')] as HTMLInputElement[]
    colors[0]!.value = '#00ff00'
    colors[0]!.dispatchEvent(new Event('change', { bubbles: true }))
    ;(host.querySelector('button[data-action="clear-fill"]') as HTMLButtonElement).click()

    const sideButtons = [...host.querySelectorAll('button[data-border-side]')] as HTMLButtonElement[]
    sideButtons.find((button) => button.dataset.borderSide === 'left')?.click()
    sideButtons.find((button) => button.dataset.borderSide === 'bottom')?.click()
    ;(host.querySelector('button[data-action="apply-borders"]') as HTMLButtonElement).click()
    ;(host.querySelector('button[data-action="clear-borders"]') as HTMLButtonElement).click()

    expect(events.fills).toEqual([{ color: { type: 'srgb', v: '00FF00' } }, null])
    expect(events.borders[0]).toEqual({
      left: { color: { type: 'srgb', v: '000000' }, width: 12700, style: 'solid' },
      bottom: { color: { type: 'srgb', v: '000000' }, width: 12700, style: 'solid' },
    })
    expect(events.borders[1]).toEqual({ left: null, bottom: null })

    app.unmount()
    host.remove()
  })

  it('does not emit border commands without selected sides', () => {
    const { app, host, events } = mountToolbar(true)

    ;(host.querySelector('button[data-action="apply-borders"]') as HTMLButtonElement).click()
    ;(host.querySelector('button[data-action="clear-borders"]') as HTMLButtonElement).click()

    expect(events.borders).toEqual([])
    app.unmount()
    host.remove()
  })
})

describe('TableFormattingToolbar cell gradient and pattern', () => {
  it('emits a gradient cell fill and a pattern cell fill', () => {
    const { app, host, events } = mountToolbar(true)
    const gs = host.querySelector('[data-table-fill-gradient-start]') as HTMLInputElement
    gs.value = '#ff0000'
    gs.dispatchEvent(new Event('change'))
    const pp = host.querySelector('[data-table-fill-pattern-preset]') as HTMLSelectElement
    pp.value = 'pct25'
    pp.dispatchEvent(new Event('change'))

    const gradientFill = events.fills.find((f) => (f as { gradient?: unknown }).gradient) as { gradient: { stops: unknown[] } }
    expect(gradientFill.gradient.stops).toHaveLength(2)
    const patternFill = events.fills.find((f) => (f as { pattern?: unknown }).pattern) as { pattern: { preset: string } }
    expect(patternFill.pattern.preset).toBe('pct25')
    app.unmount()
    host.remove()
  })
})

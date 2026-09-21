// @vitest-environment happy-dom

import { createApp, h } from 'vue'
import { describe, expect, it } from 'vitest'
import ShapePaintToolbar from './ShapePaintToolbar.vue'
import { createPpt4aiI18n } from './i18n'
import type { StrokeStyle } from '@ppt4ai/model'

interface Events {
  fills: unknown[]
  strokes: unknown[]
  widths: unknown[]
  styles: unknown[]
}

interface MountOptions {
  active?: boolean
  fillIsGradient?: boolean
  strokeIsGradient?: boolean
  strokeWidth?: number
  strokeStyle?: StrokeStyle
}

/**
 * Props are assembled with conditional spreads rather than a `Partial` spread: under
 * `exactOptionalPropertyTypes` an explicitly `undefined` optional prop is a type error.
 */
function mountToolbar(options: MountOptions = {}) {
  const events: Events = { fills: [], strokes: [], widths: [], styles: [] }
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup: () => () => h(ShapePaintToolbar, {
      active: options.active ?? true,
      fillColor: '#4472c4',
      fillIsGradient: options.fillIsGradient ?? false,
      strokeColor: '#203864',
      strokeIsGradient: options.strokeIsGradient ?? false,
      ...(options.strokeWidth === undefined ? {} : { strokeWidth: options.strokeWidth }),
      ...(options.strokeStyle === undefined ? {} : { strokeStyle: options.strokeStyle }),
      'onSet-fill': (fill: unknown) => { events.fills.push(fill) },
      'onSet-stroke': (stroke: unknown) => { events.strokes.push(stroke) },
      'onSet-stroke-width': (width: unknown) => { events.widths.push(width) },
      'onSet-stroke-style': (style: unknown) => { events.styles.push(style) },
    }),
  })
  app.use(createPpt4aiI18n())
  app.mount(host)
  return { app, host, events }
}

function input(host: HTMLElement, selector: string): HTMLInputElement {
  const element = host.querySelector(selector)
  if (!element) throw new Error(`missing control: ${selector}`)
  return element as HTMLInputElement
}

describe('ShapePaintToolbar', () => {
  it('renders a control for each editable paint property', () => {
    const { app, host } = mountToolbar()

    expect(host.querySelector('[data-shape-fill-color]')).not.toBeNull()
    expect(host.querySelector('[data-shape-stroke-color]')).not.toBeNull()
    expect(host.querySelector('[data-shape-stroke-width]')).not.toBeNull()
    expect(host.querySelector('[data-shape-stroke-style]')).not.toBeNull()
    app.unmount()
  })

  it('disables every control when inactive', () => {
    const { app, host } = mountToolbar({ active: false })

    for (const control of host.querySelectorAll('input, select, button')) {
      expect((control as HTMLInputElement).disabled).toBe(true)
    }
    app.unmount()
  })

  it('emits a solid fill when the colour changes', () => {
    const { app, host, events } = mountToolbar()
    const control = input(host, '[data-shape-fill-color]')
    control.value = '#ff0000'
    control.dispatchEvent(new Event('change'))

    expect(events.fills).toEqual([{ color: { type: 'srgb', v: 'FF0000' } }])
    app.unmount()
  })

  it('emits a solid outline when the colour changes', () => {
    const { app, host, events } = mountToolbar()
    const control = input(host, '[data-shape-stroke-color]')
    control.value = '#00ff00'
    control.dispatchEvent(new Event('change'))

    expect(events.strokes).toEqual([{ color: { type: 'srgb', v: '00FF00' } }])
    app.unmount()
  })

  /** The toolbar shows points; the command takes EMU. */
  it('emits the width in EMU', () => {
    const { app, host, events } = mountToolbar({ strokeWidth: 12700 })
    const control = input(host, '[data-shape-stroke-width]')
    expect(control.value).toBe('1')

    control.value = '6'
    control.dispatchEvent(new Event('input'))
    control.dispatchEvent(new Event('change'))

    expect(events.widths).toEqual([76200])
    app.unmount()
  })

  it('emits null from each clear button', () => {
    const { app, host, events } = mountToolbar({ strokeWidth: 12700 })
    for (const action of ['clear-fill', 'clear-stroke', 'clear-stroke-width']) {
      (host.querySelector(`[data-action="${action}"]`) as HTMLButtonElement).click()
    }

    expect(events.fills).toEqual([null])
    expect(events.strokes).toEqual([null])
    expect(events.widths).toEqual([null])
    app.unmount()
  })

  it('emits the selected dash style', () => {
    const { app, host, events } = mountToolbar({ strokeStyle: 'solid' })
    const control = host.querySelector('[data-shape-stroke-style]') as HTMLSelectElement
    control.value = 'dot'
    control.dispatchEvent(new Event('change'))

    expect(events.styles).toEqual(['dot'])
    app.unmount()
  })

  /** An absent width is inherited from the theme, so the box shows nothing rather than a zero. */
  it('leaves the width box empty when the element inherits it', () => {
    const { app, host } = mountToolbar()

    expect(input(host, '[data-shape-stroke-width]').value).toBe('')
    app.unmount()
  })

  /**
   * A gradient has no single colour. The swatch is marked rather than silently claiming the first
   * stop, because clicking it replaces the ramp with a flat colour.
   */
  it('marks a gradient fill and outline', () => {
    const { app, host } = mountToolbar({ fillIsGradient: true, strokeIsGradient: true })

    expect(host.querySelector('[data-shape-fill-gradient]')).not.toBeNull()
    expect(host.querySelector('[data-shape-stroke-gradient]')).not.toBeNull()
    app.unmount()
  })

  it('marks neither swatch for flat paint', () => {
    const { app, host } = mountToolbar()

    expect(host.querySelector('[data-shape-fill-gradient]')).toBeNull()
    expect(host.querySelector('[data-shape-stroke-gradient]')).toBeNull()
    app.unmount()
  })
})

describe('ShapePaintToolbar fill gradient', () => {
  it('emits a two-stop gradient fill when the gradient start swatch changes', () => {
    const { app, host, events } = mountToolbar({ fillIsGradient: true })
    const start = host.querySelector('[data-shape-fill-gradient-start]') as HTMLInputElement
    start.value = '#ff0000'
    start.dispatchEvent(new Event('change'))

    const fill = events.fills.at(-1) as { color?: { v?: string }; gradient?: { stops: unknown[]; angle?: number } }
    expect(fill.gradient?.stops).toHaveLength(2)
    expect(fill.color?.v).toBe('FF0000')
    app.unmount()
    host.remove()
  })
})

describe('ShapePaintToolbar fill pattern', () => {
  it('emits a pattern fill when the preset changes', () => {
    const { app, host, events } = mountToolbar()
    const select = host.querySelector('[data-shape-fill-pattern-preset]') as HTMLSelectElement
    select.value = 'pct25'
    select.dispatchEvent(new Event('change'))

    const fill = events.fills.at(-1) as { color?: { v?: string }; pattern?: { preset: string } }
    expect(fill.pattern?.preset).toBe('pct25')
    app.unmount()
    host.remove()
  })
})

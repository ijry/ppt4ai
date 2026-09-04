// @vitest-environment happy-dom

import type { Color } from '@ppt4ai/model'
import { createApp, h } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import SlideBackgroundPanel from './SlideBackgroundPanel.vue'
import { createPpt4aiI18n } from './i18n'
import { slideBackgroundModel, type SlideBackgroundPanelModel } from './slide-background-panel'

interface Events {
  colors: Color[]
  clears: number
}

function mountPanel(model: SlideBackgroundPanelModel) {
  const events: Events = { colors: [], clears: 0 }
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup: () => () => h(SlideBackgroundPanel, {
      model,
      onSetColor: (color: Color) => events.colors.push(color),
      onClear: () => { events.clears += 1 },
    }),
  })
  app.use(createPpt4aiI18n('zh-CN')).mount(host)
  return { app, host, events }
}

afterEach(() => { document.body.innerHTML = '' })

describe('SlideBackgroundPanel', () => {
  it('shows the resolved colour and emits the picked one', () => {
    const { app, host, events } = mountPanel(slideBackgroundModel({ fill: { color: { type: 'srgb', v: '1F3864' } } }, { rgb: '1F3864', alpha: 100000 }))
    const input = host.querySelector('[data-slide-background-color]') as HTMLInputElement

    expect(input.value.toUpperCase()).toBe('#1F3864')
    expect(host.textContent).toContain('#1F3864')

    input.value = '#ff0000'
    input.dispatchEvent(new Event('change'))

    expect(events.colors).toEqual([{ type: 'srgb', v: 'FF0000' }])
    app.unmount()
  })

  it('clears a background the slide owns', () => {
    const { app, host, events } = mountPanel(slideBackgroundModel({ fill: { color: { type: 'srgb', v: '1F3864' } } }, { rgb: '1F3864', alpha: 100000 }))
    const clear = host.querySelector('[data-slide-background-clear]') as HTMLButtonElement

    expect(clear.disabled).toBe(false)
    clear.click()

    expect(events.clears).toBe(1)
    app.unmount()
  })

  /** Nothing to clear when the colour came from the layout or the master, and the panel says where from. */
  it('disables clearing and explains an inherited background', () => {
    const { app, host } = mountPanel(slideBackgroundModel(undefined, { rgb: 'FFFFFF', alpha: 100000 }))

    expect((host.querySelector('[data-slide-background-clear]') as HTMLButtonElement).disabled).toBe(true)
    expect(host.querySelector('[role="note"]')?.textContent).toContain('继承自版式或母版')
    app.unmount()
  })

  it('says a gradient is a gradient instead of showing one stop', () => {
    const gradient = slideBackgroundModel(
      {
        fill: {
          color: { type: 'srgb', v: '1F3864' },
          gradient: { stops: [{ pos: 0, color: { type: 'srgb', v: '1F3864' } }, { pos: 100000, color: { type: 'srgb', v: 'FFFFFF' } }] },
        },
      },
      { rgb: '1F3864', alpha: 100000 },
    )
    const { app, host } = mountPanel(gradient)

    expect(host.querySelector('[role="note"]')?.textContent).toContain('渐变背景')
    app.unmount()
  })

  it('disables both controls when no slide is available', () => {
    const { app, host } = mountPanel(slideBackgroundModel(undefined, undefined, undefined, false))

    expect((host.querySelector('[data-slide-background-color]') as HTMLInputElement).disabled).toBe(true)
    expect((host.querySelector('[data-slide-background-clear]') as HTMLButtonElement).disabled).toBe(true)
    app.unmount()
  })
})

// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { Popover } from './index'

afterEach(() => { document.body.innerHTML = '' })

function mount() {
  const el = document.createElement('div'); document.body.append(el)
  createApp({
    render: () => h(Popover, null, {
      trigger: ({ toggle }: { toggle: () => void }) => h('button', { 'data-trigger': '', onClick: toggle }, 'open'),
      default: ({ close }: { close: () => void }) => h('button', { 'data-item': '', onClick: close }, 'pick'),
    }),
  }).mount(el)
  return el
}

describe('Popover', () => {
  it('opens on trigger, closes on item click and on outside pointerdown', async () => {
    const el = mount()
    expect(el.querySelector('[data-popover]')).toBeNull()
    ;(el.querySelector('[data-trigger]') as HTMLElement).click()
    await nextTick()
    expect(el.querySelector('[data-popover]')).not.toBeNull()
    ;(el.querySelector('[data-item]') as HTMLElement).click()
    await nextTick()
    expect(el.querySelector('[data-popover]')).toBeNull()

    // reopen, then click outside
    ;(el.querySelector('[data-trigger]') as HTMLElement).click()
    await nextTick()
    expect(el.querySelector('[data-popover]')).not.toBeNull()
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await nextTick()
    expect(el.querySelector('[data-popover]')).toBeNull()
  })
})

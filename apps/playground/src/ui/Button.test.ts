// @vitest-environment happy-dom
import { createApp, h, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import Button from './Button.vue'

let app: App | undefined
function mount(props: Record<string, unknown>, onClick: () => void) {
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(Button, { ...props, onClick }, () => 'Go') })
  app.mount(host)
  return host.querySelector('button')!
}

afterEach(() => { app?.unmount(); document.body.innerHTML = '' })

describe('Button', () => {
  it('emits click and renders its slot', () => {
    let clicked = 0
    const btn = mount({ variant: 'primary' }, () => { clicked += 1 })
    expect(btn.textContent).toContain('Go')
    expect(btn.className).toContain('btn-primary')
    btn.click()
    expect(clicked).toBe(1)
  })

  it('does not emit when disabled', () => {
    let clicked = 0
    const btn = mount({ disabled: true }, () => { clicked += 1 })
    expect(btn.disabled).toBe(true)
    btn.click()
    expect(clicked).toBe(0)
  })
})

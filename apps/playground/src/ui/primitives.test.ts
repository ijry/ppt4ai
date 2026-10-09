// @vitest-environment happy-dom
import { createApp, h } from 'vue'
import { describe, expect, it } from 'vitest'
import { Panel, Field } from './index'

function html(node: unknown): string {
  const host = document.createElement('div'); document.body.append(host)
  createApp({ render: () => node }).mount(host)
  return host.innerHTML
}

describe('layout primitives', () => {
  it('Panel renders its title and slot', () => {
    const out = html(h(Panel, { title: '背景' }, () => 'body'))
    expect(out).toContain('背景'); expect(out).toContain('body')
  })
  it('Field renders label and control', () => {
    const out = html(h(Field, { label: '宽度' }, () => 'ctrl'))
    expect(out).toContain('宽度'); expect(out).toContain('ctrl')
  })
})

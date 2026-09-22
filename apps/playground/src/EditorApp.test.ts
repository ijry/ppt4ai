// @vitest-environment happy-dom
import { createApp, h } from 'vue'
import { describe, expect, it } from 'vitest'
import EditorApp from './EditorApp.vue'

describe('EditorApp', () => {
  it('renders the four regions', () => {
    const host = document.createElement('div'); document.body.append(host)
    createApp({ render: () => h(EditorApp) }).mount(host)
    for (const r of ['toolbar', 'navigator', 'stage', 'inspector']) {
      expect(host.querySelector(`[data-region="${r}"]`)).not.toBeNull()
    }
  })
})

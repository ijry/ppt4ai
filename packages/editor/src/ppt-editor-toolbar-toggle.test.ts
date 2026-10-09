// @vitest-environment happy-dom
import { createApp, h } from 'vue'
import { describe, expect, it } from 'vitest'
import PptEditor from './PptEditor.vue'
import { createPpt4aiI18n } from './i18n'

function mount(props: Record<string, unknown>) {
  const el = document.createElement('div'); document.body.append(el)
  const app = createApp({ render: () => h(PptEditor, props as never) })
  app.use(createPpt4aiI18n())
  app.mount(el); return el
}

describe('PptEditor showObjectToolbar', () => {
  it('renders its object toolbar by default and hides it when false', () => {
    expect(mount({}).querySelector('.ppt-editor__toolbar')).not.toBeNull()
    document.body.innerHTML = ''
    expect(mount({ showObjectToolbar: false }).querySelector('.ppt-editor__toolbar')).toBeNull()
  })
})

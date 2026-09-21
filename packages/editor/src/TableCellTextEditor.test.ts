// @vitest-environment happy-dom
import type { TextBody } from '@ppt4ai/model'
import type { SceneTableLayoutCell } from '@ppt4ai/render'
import type { ImeInputBridge, ImeInputBridgeOptions } from '@ppt4ai/text'
import { createApp, h, nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import TableCellTextEditor from './TableCellTextEditor.vue'

const cell = {
  row: 0,
  column: 0,
  rowSpan: 1,
  colSpan: 2,
  bounds: { x: 10, y: 20, w: 120, h: 40 },
  body: { paragraphs: [{ runs: [] }] },
  borders: {},
  textLayout: {},
  resolvedStyle: { borders: {} },
} as unknown as SceneTableLayoutCell

interface BridgeHarness {
  options?: ImeInputBridgeOptions
}

function createBridgeFactory(harness: BridgeHarness) {
  return (options: ImeInputBridgeOptions): ImeInputBridge => {
    harness.options = options
    return {
      focus: () => {},
      setCaretRect: () => {},
      getCaretClientRect: () => new DOMRect(),
      destroy: () => {},
    }
  }
}

function mountEditor() {
  const harness: BridgeHarness = {}
  const events = {
    drafts: [] as TextBody[],
    commits: [] as TextBody[],
    cancels: 0,
  }
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup: () => () => h(TableCellTextEditor, {
      active: true,
      cell,
      transform: { originX: 0, originY: 0, scale: 1 },
      bridgeFactory: createBridgeFactory(harness),
      'onUpdate:draft': (body: TextBody) => events.drafts.push(body),
      onCommit: (body: TextBody) => events.commits.push(body),
      onCancel: () => { events.cancels += 1 },
    }),
  })
  app.mount(host)
  return { app, events, harness, host }
}

async function flushClose(): Promise<void> {
  await Promise.resolve()
  await nextTick()
}

describe('TableCellTextEditor', () => {
  it('uses complete merged source bounds without a resize frame', async () => {
    const mounted = mountEditor()
    await nextTick()

    const surface = mounted.host.querySelector('[data-text-box-surface]') as HTMLElement
    expect(surface.style.left).toBe('10px')
    expect(surface.style.top).toBe('20px')
    expect(surface.style.width).toBe('120px')
    expect(surface.style.height).toBe('40px')
    expect(mounted.host.querySelector('[data-text-caret]')).not.toBeNull()
    expect(mounted.host.querySelector('[data-selection-border]')).toBeNull()
    expect(mounted.host.querySelectorAll('[data-selection-handle]')).toHaveLength(0)

    mounted.app.unmount()
    mounted.host.remove()
  })

  it('keeps body and composition changes local until commit', async () => {
    const mounted = mountEditor()
    await nextTick()

    mounted.harness.options?.onEvent({ type: 'text-input', text: 'A' })
    mounted.harness.options?.onEvent({ type: 'composition-start' })
    mounted.harness.options?.onEvent({ type: 'composition-update', text: 'zhong' })
    await nextTick()

    expect(mounted.events.drafts).toEqual([{ paragraphs: [{ runs: [{ text: 'A' }] }] }])
    expect(mounted.events.commits).toEqual([])
    expect(mounted.host.querySelectorAll('[data-text-composition]').length).toBeGreaterThan(0)

    mounted.harness.options?.onEvent({ type: 'composition-end', text: '中' })
    await nextTick()
    expect(mounted.events.drafts.at(-1)).toEqual({ paragraphs: [{ runs: [{ text: 'A中' }] }] })
    expect(mounted.events.commits).toEqual([])

    const root = mounted.host.querySelector('[data-table-cell-text-editor]') as HTMLElement
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(mounted.events.commits).toEqual([{ paragraphs: [{ runs: [{ text: 'A中' }] }] }])

    mounted.app.unmount()
    mounted.host.remove()
  })

  it('keeps ordinary Enter in the draft and intercepts session shortcuts once', async () => {
    const mounted = mountEditor()
    await nextTick()
    const root = mounted.host.querySelector('[data-table-cell-text-editor]') as HTMLElement

    mounted.harness.options?.onEvent({ type: 'text-input', text: 'A' })
    mounted.harness.options?.onEvent({ type: 'insert-line-break' })
    await nextTick()
    expect(mounted.events.drafts.at(-1)?.paragraphs).toHaveLength(2)
    expect(mounted.events.commits).toEqual([])

    const commitEvent = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })
    root.dispatchEvent(commitEvent)
    root.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }))
    await flushClose()
    expect(commitEvent.defaultPrevented).toBe(true)
    expect(mounted.events.commits).toHaveLength(1)
    expect(mounted.events.cancels).toBe(0)

    mounted.app.unmount()
    mounted.host.remove()
  })

  it('cancels without a body and closes at most once', async () => {
    const mounted = mountEditor()
    await nextTick()
    const root = mounted.host.querySelector('[data-table-cell-text-editor]') as HTMLElement
    const cancelEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })

    root.dispatchEvent(cancelEvent)
    root.dispatchEvent(cancelEvent)
    root.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }))
    await flushClose()

    expect(cancelEvent.defaultPrevented).toBe(true)
    expect(mounted.events.cancels).toBe(1)
    expect(mounted.events.commits).toEqual([])

    mounted.app.unmount()
    mounted.host.remove()
  })

  it('defers blur commit until composition publishes its final body', async () => {
    const mounted = mountEditor()
    await nextTick()
    const root = mounted.host.querySelector('[data-table-cell-text-editor]') as HTMLElement

    mounted.harness.options?.onEvent({ type: 'composition-start' })
    mounted.harness.options?.onEvent({ type: 'composition-update', text: 'zhong' })
    root.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }))
    await flushClose()
    expect(mounted.events.commits).toEqual([])

    mounted.harness.options?.onEvent({ type: 'composition-end', text: '中' })
    await flushClose()
    expect(mounted.events.commits).toEqual([{ paragraphs: [{ runs: [{ text: '中' }] }] }])

    mounted.app.unmount()
    mounted.host.remove()
  })
})

// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import AppToolbar from './AppToolbar.vue'
import type { PlaygroundPresentationSnapshot } from '../presentation-host'

function snap(over: Partial<{ undo: number; clipboard: boolean }> = {}): PlaygroundPresentationSnapshot {
  return { slideOrder: ['s'], activeSlideId: 's',
    slides: { s: { id: 's', title: 's', thumbnailScene: {}, engineState: { selection: new Set(), document: { elements: {} }, history: { undoDepth: over.undo ?? 0, redoDepth: 0 } } } },
    presentationHistory: { undoDepth: 0, redoDepth: 0 }, clipboard: { hasContent: over.clipboard ?? false, rootCount: 0, elementCount: 0 }, status: 'idle' } as unknown as PlaygroundPresentationSnapshot
}

function mount(props: Record<string, unknown>) {
  const el = document.createElement('div'); document.body.append(el)
  createApp({ render: () => h(AppToolbar, props as never) }).mount(el)
  return el
}

describe('AppToolbar ribbon', () => {
  it('shows the Home tab by default: undo disabled, add emits', () => {
    const events: string[] = []
    const el = mount({ snapshot: snap(), onAdd: () => events.push('add') })
    expect((el.querySelector('[data-act="undo"]') as HTMLButtonElement).disabled).toBe(true)
    expect((el.querySelector('[data-act="delete"]') as HTMLButtonElement).disabled).toBe(true)
    ;(el.querySelector('[data-act="add"]') as HTMLElement).click()
    expect(events).toContain('add')
  })

  it('reveals insert tools on the Insert tab; shape gallery emits a preset', async () => {
    const events: Array<[string, unknown]> = []
    const el = mount({ snapshot: snap(), 'onInsert-text': () => events.push(['text', null]), 'onInsert-shape': (p: string) => events.push(['shape', p]), 'onInsert-image': () => events.push(['image', null]) })
    expect(el.querySelector('[data-act="insert-text"]')).toBeNull() // not on Home tab
    ;(el.querySelector('[data-tab="insert"]') as HTMLElement).click()
    await nextTick()
    ;(el.querySelector('[data-act="insert-text"]') as HTMLElement).click()
    ;(el.querySelector('[data-act="insert-image"]') as HTMLElement).click()
    ;(el.querySelector('[data-act="insert-shape"]') as HTMLElement).click() // opens the shape popover
    await nextTick()
    ;(el.querySelector('[data-shape="ellipse"]') as HTMLElement).click()
    expect(events).toEqual([['text', null], ['image', null], ['shape', 'ellipse']])
  })

  it('disables arrange tools with no selection', async () => {
    const el = mount({ snapshot: snap() })
    ;(el.querySelector('[data-tab="arrange"]') as HTMLElement).click()
    await nextTick()
    expect((el.querySelector('[data-act="to-front"]') as HTMLButtonElement).disabled).toBe(true)
    expect((el.querySelector('[data-act="align-left"]') as HTMLButtonElement).disabled).toBe(true)
    expect((el.querySelector('[data-act="distribute-h"]') as HTMLButtonElement).disabled).toBe(true)
  })
})

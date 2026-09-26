// @vitest-environment happy-dom
import { createApp, h } from 'vue'
import { describe, expect, it } from 'vitest'
import AppToolbar from './AppToolbar.vue'
import type { PlaygroundPresentationSnapshot } from '../presentation-host'

function snap(over: Partial<{ undo: number; clipboard: boolean }> = {}): PlaygroundPresentationSnapshot {
  return { slideOrder: ['s'], activeSlideId: 's',
    slides: { s: { id: 's', title: 's', thumbnailScene: {}, engineState: { selection: new Set(), document: { elements: {} }, history: { undoDepth: over.undo ?? 0, redoDepth: 0 } } } },
    presentationHistory: { undoDepth: 0, redoDepth: 0 }, clipboard: { hasContent: over.clipboard ?? false, rootCount: 0, elementCount: 0 }, status: 'idle' } as unknown as PlaygroundPresentationSnapshot
}

describe('AppToolbar', () => {
  it('disables undo with empty history and emits add', () => {
    const events: string[] = []
    const el = document.createElement('div'); document.body.append(el)
    createApp({ render: () => h(AppToolbar, { snapshot: snap(), onAdd: () => events.push('add') }) }).mount(el)
    expect((el.querySelector('[data-act="undo"]') as HTMLButtonElement).disabled).toBe(true)
    ;(el.querySelector('[data-act="add"]') as HTMLElement).click()
    expect(events).toContain('add')
  })

  it('emits insert-text and insert-shape (always enabled)', () => {
    const events: string[] = []
    const el = document.createElement('div'); document.body.append(el)
    createApp({ render: () => h(AppToolbar, { snapshot: snap(), 'onInsert-text': () => events.push('text'), 'onInsert-shape': () => events.push('shape') }) }).mount(el)
    ;(el.querySelector('[data-act="insert-text"]') as HTMLElement).click()
    ;(el.querySelector('[data-act="insert-shape"]') as HTMLElement).click()
    expect(events).toEqual(['text', 'shape'])
  })

  it('disables reorder-to-front with no selection', () => {
    const el = document.createElement('div'); document.body.append(el)
    createApp({ render: () => h(AppToolbar, { snapshot: snap() }) }).mount(el)
    expect((el.querySelector('[data-act="to-front"]') as HTMLButtonElement).disabled).toBe(true)
    expect((el.querySelector('[data-act="delete"]') as HTMLButtonElement).disabled).toBe(true)
  })
})

// @vitest-environment happy-dom
import { createApp, h } from 'vue'
import { EditorEngine } from '@ppt4ai/engine'
import type { Rect } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import SelectionOverlay from './SelectionOverlay.vue'
import { createSelectionOverlay, resizeBounds, resizeBoundsWithAspectRatio, type SelectionHandle } from './selection-overlay'

const bounds: Rect = { x: 10, y: 20, w: 100, h: 60 }

describe('selection overlay geometry', () => {
  it('places an active border and eight handles around the source bounds', () => {
    const overlay = createSelectionOverlay(bounds, { handleSize: 8 })

    expect(overlay.border).toEqual(bounds)
    expect(overlay.border).not.toBe(bounds)
    expect(overlay.handles.map(({ name }) => name)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'])
    expect(overlay.handles.find(({ name }) => name === 'nw')?.rect).toEqual({ x: 6, y: 16, w: 8, h: 8 })
    expect(overlay.handles.find(({ name }) => name === 'e')?.rect).toEqual({ x: 106, y: 46, w: 8, h: 8 })
  })

  it.each([
    ['nw', { x: 30, y: 35 }, { x: 30, y: 35, w: 80, h: 45 }],
    ['n', { x: 0, y: 35 }, { x: 10, y: 35, w: 100, h: 45 }],
    ['ne', { x: 130, y: 35 }, { x: 10, y: 35, w: 120, h: 45 }],
    ['e', { x: 130, y: 0 }, { x: 10, y: 20, w: 120, h: 60 }],
    ['se', { x: 140, y: 100 }, { x: 10, y: 20, w: 130, h: 80 }],
    ['s', { x: 0, y: 100 }, { x: 10, y: 20, w: 100, h: 80 }],
    ['sw', { x: 40, y: 100 }, { x: 40, y: 20, w: 70, h: 80 }],
    ['w', { x: 40, y: 0 }, { x: 40, y: 20, w: 70, h: 60 }],
  ] as const)('resizes from the %s handle while keeping the opposite edge fixed', (handle, pointer, expected) => {
    expect(resizeBounds(bounds, handle as SelectionHandle, pointer)).toEqual(expected)
  })

  it('clamps corner resize to minimum dimensions without flipping', () => {
    expect(resizeBounds(bounds, 'nw', { x: 200, y: 200 }, { minWidth: 30, minHeight: 25 })).toEqual({
      x: 80,
      y: 55,
      w: 30,
      h: 25,
    })
  })

  it('keeps the starting ratio for a corner resize with aspect locking', () => {
    expect(resizeBoundsWithAspectRatio(
      bounds,
      'se',
      { x: 150, y: 104 },
    )).toEqual({ x: 10, y: 20, w: 140, h: 84 })
  })

  it('keeps the opposite corner fixed while locking a north-west resize', () => {
    expect(resizeBoundsWithAspectRatio(
      bounds,
      'nw',
      { x: -20, y: 2 },
    )).toEqual({ x: -20, y: 2, w: 130, h: 78 })
  })

  it('does not force an aspect ratio for an edge handle', () => {
    expect(resizeBoundsWithAspectRatio(
      bounds,
      'e',
      { x: 160, y: 100 },
    )).toEqual({ x: 10, y: 20, w: 150, h: 60 })
  })

  it('rejects non-finite pointer values', () => {
    expect(() => resizeBounds(bounds, 'n', { x: Number.NaN, y: 0 })).toThrow('pointer must be finite')
  })

  it('feeds resized bounds into the existing engine resize command', () => {
    const engine = new EditorEngine({
      format: 'ppt4ai',
      version: 1,
      id: 'doc-1',
      page: { w: 960, h: 540 },
      slideOrder: ['slide-1'],
      slides: { 'slide-1': { id: 'slide-1', elementIds: ['text-1'] } },
      elements: { 'text-1': { id: 'text-1', kind: 'text', bounds } },
    })
    const resized = resizeBounds(bounds, 'se', { x: 140, y: 100 })

    const state = engine.dispatch({ type: 'resize', elementId: 'text-1', bounds: resized })

    expect(state.document.elements['text-1']?.bounds).toEqual({ x: 10, y: 20, w: 130, h: 80 })
    expect(state.history.undoDepth).toBe(1)
  })

  it('renders no overlay while inactive and one border with eight handles while active', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp({
      setup: () => () => h(SelectionOverlay, { active: true, bounds }),
    })
    app.mount(host)

    expect(host.querySelector('.ppt-selection-overlay')).not.toBeNull()
    expect(host.querySelectorAll('[data-selection-handle]')).toHaveLength(8)
    expect(host.querySelectorAll('[data-selection-border]')).toHaveLength(1)

    app.unmount()
    host.remove()
  })

  it('renders nothing when the selection is inactive', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp({
      setup: () => () => h(SelectionOverlay, { active: false, bounds }),
    })
    app.mount(host)

    expect(host.querySelector('.ppt-selection-overlay')).toBeNull()

    app.unmount()
    host.remove()
  })

  it('emits the current Shift modifier with resize pointer payloads', () => {
    const events: unknown[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp({
      setup: () => () => h(SelectionOverlay, {
        active: true,
        bounds,
        onResizeStart: (payload: unknown) => events.push(payload),
        onResize: (payload: unknown) => events.push(payload),
      }),
    })
    app.mount(host)

    const handle = host.querySelector('[data-selection-handle="se"]') as HTMLButtonElement
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 140, clientY: 80, pointerId: 5, shiftKey: true, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, clientY: 90, pointerId: 5, shiftKey: false, bubbles: true }))

    expect(events).toEqual([
      { handle: 'se', point: { x: 140, y: 80 }, shiftKey: true },
      { handle: 'se', point: { x: 150, y: 90 }, shiftKey: false },
    ])

    app.unmount()
    host.remove()
  })
})

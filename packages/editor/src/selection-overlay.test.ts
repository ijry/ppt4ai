// @vitest-environment happy-dom
import { createApp, h } from 'vue'
import { EditorEngine } from '@ppt4ai/engine'
import type { Rect } from '@ppt4ai/model'
import { describe, expect, it, vi } from 'vitest'
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

  it('resizes an east edge symmetrically around the starting center', () => {
    expect(resizeBounds(bounds, 'e', { x: 160, y: 50 }, { center: true })).toEqual({
      x: -40, y: 20, w: 200, h: 60,
    })
  })

  it('keeps the center and ratio for an Alt-Shift corner resize', () => {
    expect(resizeBoundsWithAspectRatio(
      bounds,
      'se',
      { x: 150, y: 104 },
      { center: true },
    )).toEqual({ x: -30, y: -4, w: 180, h: 108 })
  })

  it('clamps centered resize at the minimum without crossing the center', () => {
    expect(resizeBounds(bounds, 'nw', { x: 55, y: 52 }, {
      center: true,
      minWidth: 30,
      minHeight: 25,
    })).toEqual({ x: 45, y: 37.5, w: 30, h: 25 })
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

  it('emits the current Shift and Alt modifiers with resize pointer payloads', () => {
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
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 140, clientY: 80, pointerId: 5, shiftKey: true, altKey: true, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, clientY: 90, pointerId: 5, shiftKey: false, altKey: false, bubbles: true }))

    expect(events).toEqual([
      { handle: 'se', point: { x: 140, y: 80 }, shiftKey: true, altKey: true },
      { handle: 'se', point: { x: 150, y: 90 }, shiftKey: false, altKey: false },
    ])

    app.unmount()
    host.remove()
  })

  it('renders an optional rotation handle and rotates the selection frame', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp({
      setup: () => () => h(SelectionOverlay, {
        active: true,
        bounds,
        rotation: 5400000,
        showRotationHandle: true,
      }),
    })
    app.mount(host)

    expect(host.querySelectorAll('[data-selection-rotation-handle]')).toHaveLength(1)
    expect(host.querySelectorAll('[data-selection-rotation-connector]')).toHaveLength(1)
    expect((host.querySelector('[data-selection-frame]') as HTMLElement).style.transform).toBe('rotate(90deg)')

    app.unmount()
    host.remove()

    const defaultHost = document.createElement('div')
    document.body.append(defaultHost)
    const defaultApp = createApp({
      setup: () => () => h(SelectionOverlay, { active: true, bounds }),
    })
    defaultApp.mount(defaultHost)

    expect(defaultHost.querySelector('[data-selection-rotation-handle]')).toBeNull()

    defaultApp.unmount()
    defaultHost.remove()
  })

  it('emits current rotation modifiers and releases capture on cancel', () => {
    const events: unknown[] = []
    const cancelEvents: unknown[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp({
      setup: () => () => h(SelectionOverlay, {
        active: true,
        bounds,
        showRotationHandle: true,
        onRotateStart: (payload: unknown) => events.push(payload),
        onRotate: (payload: unknown) => events.push(payload),
        onRotateCancel: (payload: unknown) => cancelEvents.push(payload),
      }),
    })
    app.mount(host)

    const handle = host.querySelector('[data-selection-rotation-handle]') as HTMLButtonElement
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    handle.setPointerCapture = setPointerCapture
    handle.releasePointerCapture = releasePointerCapture
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 140, clientY: 20, pointerId: 7, shiftKey: true, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, clientY: 30, pointerId: 7, shiftKey: false, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointercancel', { clientX: 160, clientY: 40, pointerId: 7, shiftKey: true, bubbles: true }))

    expect(events).toEqual([
      { point: { x: 140, y: 20 }, shiftKey: true },
      { point: { x: 150, y: 30 }, shiftKey: false },
    ])
    expect(cancelEvents).toEqual([{ point: { x: 160, y: 40 }, shiftKey: true }])
    expect(setPointerCapture).toHaveBeenCalledWith(7)
    expect(releasePointerCapture).toHaveBeenCalledWith(7)

    app.unmount()
    host.remove()
  })

  it('releases rotation pointer capture on pointerup', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp({
      setup: () => () => h(SelectionOverlay, { active: true, bounds, showRotationHandle: true }),
    })
    app.mount(host)

    const handle = host.querySelector('[data-selection-rotation-handle]') as HTMLButtonElement
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    handle.setPointerCapture = setPointerCapture
    handle.releasePointerCapture = releasePointerCapture
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 140, clientY: 20, pointerId: 8, bubbles: true }))
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 150, clientY: 30, pointerId: 8, bubbles: true }))

    expect(setPointerCapture).toHaveBeenCalledWith(8)
    expect(releasePointerCapture).toHaveBeenCalledWith(8)

    app.unmount()
    host.remove()
  })
})

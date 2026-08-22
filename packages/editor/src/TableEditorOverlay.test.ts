// @vitest-environment happy-dom
import type { SceneTableNode } from '@ppt4ai/render'
import { createApp, h, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import TableEditorOverlay from './TableEditorOverlay.vue'
import type { TableCellSelection } from './table-editor-overlay'

const table = {
  id: 'table-1',
  kind: 'table',
  bounds: { x: 0, y: 0, w: 100, h: 80 },
  layout: {
    bounds: { x: 0, y: 0, w: 100, h: 80 },
    columns: [50, 50],
    rows: [40, 40],
    borders: [],
    cells: [
      { row: 0, column: 0, rowSpan: 1, colSpan: 2, bounds: { x: 0, y: 0, w: 100, h: 40 } },
      { row: 1, column: 0, rowSpan: 1, colSpan: 1, bounds: { x: 0, y: 40, w: 50, h: 40 } },
      { row: 1, column: 1, rowSpan: 1, colSpan: 1, bounds: { x: 50, y: 40, w: 50, h: 40 } },
    ],
  },
} as unknown as SceneTableNode

function pointer(type: string, x: number, y: number, options: { button?: number; pointerId?: number } = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    clientX: { value: x },
    clientY: { value: y },
    button: { value: options.button ?? 0 },
    pointerId: { value: options.pointerId ?? 1 },
  })
  return event
}

function mountOverlay(active = true, events: { selections: TableCellSelection[]; ends: TableCellSelection[] } = { selections: [], ends: [] }) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup: () => () => h(TableEditorOverlay, {
      active,
      table,
      transform: { originX: 0, originY: 0, scale: 1 },
      onSelect: (selection: TableCellSelection) => events.selections.push(selection),
      onSelectEnd: (selection: TableCellSelection) => events.ends.push(selection),
    }),
  })
  app.mount(host)
  return { app, host, events }
}

describe('TableEditorOverlay', () => {
  it('renders no interactive grid while inactive', () => {
    const { app, host } = mountOverlay(false)
    expect(host.querySelector('[data-table-editor-overlay]')).toBeNull()
    expect(host.querySelectorAll('[data-table-cell]')).toHaveLength(0)
    app.unmount()
    host.remove()
  })

  it('renders one source-cell surface and an active border per table', () => {
    const { app, host } = mountOverlay()
    expect(host.querySelector('[role="grid"]')).not.toBeNull()
    expect(host.querySelector('[data-table-border]')).not.toBeNull()
    expect(host.querySelectorAll('[data-table-cell]')).toHaveLength(3)
    expect(host.querySelector('[data-table-cell-row="0"][data-table-cell-column="0"]')?.getAttribute('tabindex')).toBe('0')
    expect(host.querySelector('[data-table-cell-row="1"][data-table-cell-column="1"]')?.getAttribute('tabindex')).toBe('-1')
    expect(host.querySelector('[data-table-cell-row="0"][data-table-cell-column="0"]')?.getAttribute('aria-label')).toContain('row span 1')
    app.unmount()
    host.remove()
  })

  it('emits a collapsed source selection and ends exactly once on click', () => {
    const mounted = mountOverlay()
    const grid = mounted.host.querySelector('[data-table-editor-overlay]') as HTMLElement
    grid.setPointerCapture = vi.fn()
    grid.releasePointerCapture = vi.fn()
    grid.dispatchEvent(pointer('pointerdown', 75, 25, { pointerId: 7 }))
    grid.dispatchEvent(pointer('pointerup', 75, 25, { pointerId: 7 }))
    expect(mounted.events.selections).toEqual([{ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }])
    expect(mounted.events.ends).toEqual([{ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }])
    expect(grid.setPointerCapture).toHaveBeenCalledWith(7)
    expect(grid.releasePointerCapture).toHaveBeenCalledWith(7)
    expect(structuredClone(mounted.events.ends[0])).toEqual(mounted.events.ends[0])
    mounted.app.unmount()
    mounted.host.remove()
  })

  it('updates focus once per changed cell during a reverse drag', () => {
    const mounted = mountOverlay()
    const grid = mounted.host.querySelector('[data-table-editor-overlay]') as HTMLElement
    grid.setPointerCapture = vi.fn()
    grid.releasePointerCapture = vi.fn()
    grid.dispatchEvent(pointer('pointerdown', 75, 65))
    grid.dispatchEvent(pointer('pointermove', 25, 65))
    grid.dispatchEvent(pointer('pointermove', 25, 65))
    grid.dispatchEvent(pointer('pointerup', 25, 65))
    expect(mounted.events.selections).toEqual([
      { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } },
      { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 0 } },
    ])
    expect(mounted.events.ends).toHaveLength(1)
    mounted.app.unmount()
    mounted.host.remove()
  })

  it('ignores secondary-button pointerdown and activates focused cells with Enter and Space', async () => {
    const mounted = mountOverlay()
    const grid = mounted.host.querySelector('[data-table-editor-overlay]') as HTMLElement
    const firstCell = mounted.host.querySelector('[data-table-cell-row="0"][data-table-cell-column="0"]') as HTMLElement
    grid.setPointerCapture = vi.fn()
    grid.dispatchEvent(pointer('pointerdown', 25, 25, { button: 2 }))
    expect(mounted.events.selections).toEqual([])
    firstCell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    firstCell.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    await nextTick()
    expect(mounted.events.selections).toHaveLength(2)
    expect(mounted.events.ends).toHaveLength(2)
    expect(firstCell.className).toContain('focus:ring-2')
    mounted.app.unmount()
    mounted.host.remove()
  })
})

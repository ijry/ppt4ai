import type { SceneTableNode } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import * as editorEntry from './index'
import {
  createTableEditorOverlay,
  selectedTableCells,
  tableCellAtPoint,
} from './table-editor-overlay'

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
      {
        row: 0,
        column: 0,
        rowSpan: 1,
        colSpan: 2,
        bounds: { x: 0, y: 0, w: 100, h: 40 },
        body: { paragraphs: [] },
        borders: {},
        textLayout: {},
        resolvedStyle: { borders: {} },
      },
      {
        row: 1,
        column: 0,
        rowSpan: 1,
        colSpan: 1,
        bounds: { x: 0, y: 40, w: 50, h: 40 },
        body: { paragraphs: [] },
        borders: {},
        textLayout: {},
        resolvedStyle: { borders: {} },
      },
      {
        row: 1,
        column: 1,
        rowSpan: 1,
        colSpan: 1,
        bounds: { x: 50, y: 40, w: 50, h: 40 },
        body: { paragraphs: [] },
        borders: {},
        textLayout: {},
        resolvedStyle: { borders: {} },
      },
    ],
  },
} as unknown as SceneTableNode

describe('table editor overlay geometry', () => {
  it('maps table bounds and source cell rectangles through the viewport transform', () => {
    const model = createTableEditorOverlay(table, { originX: 10, originY: 20, scale: 2 })

    expect(model.bounds).toEqual({ x: 10, y: 20, width: 200, height: 160 })
    expect(model.cells[0]).toMatchObject({
      point: { row: 0, column: 0 },
      rowSpan: 1,
      colSpan: 2,
      rect: { x: 10, y: 20, width: 200, height: 80 },
    })
  })

  it('returns the merged source cell for every occupied point', () => {
    const model = createTableEditorOverlay(table, { originX: 0, originY: 0, scale: 1 })

    expect(tableCellAtPoint(model, { x: 75, y: 25 })?.point).toEqual({ row: 0, column: 0 })
    expect(tableCellAtPoint(model, { x: 100, y: 25 })?.point).toEqual({ row: 0, column: 0 })
  })

  it('reports zero rotation for an unrotated table and leaves hit testing unchanged', () => {
    const model = createTableEditorOverlay(table, { originX: 0, originY: 0, scale: 1 })

    expect(model.rotation).toBe(0)
    expect(tableCellAtPoint(model, { x: 25, y: 60 })?.point).toEqual({ row: 1, column: 0 })
  })

  it('carries the table rotation into the overlay model', () => {
    const rotated = { ...table, transform: { rotation: 2700000 } } as unknown as SceneTableNode
    const model = createTableEditorOverlay(rotated, { originX: 0, originY: 0, scale: 1 })

    expect(model.rotation).toBe(2700000)
    expect(model.bounds).toEqual({ x: 0, y: 0, width: 100, height: 80 })
  })

  it('resolves cells in rotated screen space so clicks match the painted table', () => {
    const rotated = { ...table, transform: { rotation: 10800000 } } as unknown as SceneTableNode
    const model = createTableEditorOverlay(rotated, { originX: 0, originY: 0, scale: 1 })

    // Half a turn about the centre (50, 40) maps the bottom-left cell to the top-right.
    expect(tableCellAtPoint(model, { x: 75, y: 20 })?.point).toEqual({ row: 1, column: 0 })
    expect(tableCellAtPoint(model, { x: 25, y: 60 })?.point).toEqual({ row: 0, column: 0 })
  })

  it('selects source cells whose occupied spans intersect an inclusive reverse range', () => {
    const model = createTableEditorOverlay(table, { originX: 0, originY: 0, scale: 1 })
    const selected = selectedTableCells(model.cells, {
      anchor: { row: 1, column: 1 },
      focus: { row: 0, column: 0 },
    })

    expect(selected.map((cell) => cell.point)).toEqual([
      { row: 0, column: 0 },
      { row: 1, column: 0 },
      { row: 1, column: 1 },
    ])
    expect(new Set(selected.map((cell) => `${cell.point.row}:${cell.point.column}`)).size).toBe(selected.length)
  })

  it('keeps selection payloads safe to clone', () => {
    const selection = {
      anchor: { row: 1, column: 1 },
      focus: { row: 0, column: 0 },
    }

    expect(structuredClone(selection)).toEqual(selection)
  })

  it('exports the table overlay through the editor entry point', () => {
    expect(editorEntry.TableEditorOverlay).toBeDefined()
    expect(editorEntry.createTableEditorOverlay).toBe(createTableEditorOverlay)
  })
})

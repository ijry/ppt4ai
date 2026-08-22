import type { SceneTableNode } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
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
})

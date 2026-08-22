import { describe, expect, it } from 'vitest'
import { layoutTable } from './table'
import type { TableElement } from '@ppt4ai/model'

function body(text: string) {
  return { paragraphs: [{ runs: text ? [{ text }] : [] }] }
}

describe('layoutTable', () => {
  it('places cells using cumulative EMU row and column offsets', () => {
    const table: TableElement = {
      id: 'tbl_1',
      kind: 'table',
      bounds: { x: 100, y: 200, w: 3000, h: 1200 },
      columns: [1000, 2000],
      rows: [
        { height: 500, cells: [{ column: 0, body: body('A') }, { column: 1, body: body('B') }] },
        { height: 700, cells: [{ column: 0, body: body('C') }, { column: 1, body: body('D') }] },
      ],
    }

    expect(layoutTable(table).cells.map(({ row, column, bounds }) => ({ row, column, bounds }))).toEqual([
      { row: 0, column: 0, bounds: { x: 100, y: 200, w: 1000, h: 500 } },
      { row: 0, column: 1, bounds: { x: 1100, y: 200, w: 2000, h: 500 } },
      { row: 1, column: 0, bounds: { x: 100, y: 700, w: 1000, h: 700 } },
      { row: 1, column: 1, bounds: { x: 1100, y: 700, w: 2000, h: 700 } },
    ])
  })

  it('calculates merged cell bounds and emits borders in L-R-T-B order', () => {
    const table: TableElement = {
      id: 'tbl_1',
      kind: 'table',
      bounds: { x: 100, y: 200, w: 3000, h: 1200 },
      columns: [1000, 2000],
      rows: [
        { height: 500, cells: [{ column: 0, colSpan: 2, body: body('A'), borders: {
          left: { color: { type: 'srgb', v: '111111' } },
          right: { color: { type: 'srgb', v: '222222' } },
          top: { color: { type: 'srgb', v: '333333' } },
          bottom: { color: { type: 'srgb', v: '444444' } },
        } }] },
        { height: 700, cells: [{ column: 0, body: body('B') }, { column: 1, rowSpan: 1, body: body('C') }] },
      ],
    }

    const layout = layoutTable(table)
    expect(layout.cells[0]?.bounds).toEqual({ x: 100, y: 200, w: 3000, h: 500 })
    expect(layout.borders.map(({ side }) => side)).toEqual(['left', 'right', 'top', 'bottom'])
    expect(structuredClone(layout)).toEqual(layout)
  })

  it('extends a cell across the declared row span', () => {
    const table: TableElement = {
      id: 'tbl_1',
      kind: 'table',
      bounds: { x: 0, y: 0, w: 2000, h: 1800 },
      columns: [1000, 1000],
      rows: [
        { height: 800, cells: [{ column: 0, rowSpan: 2, body: body('A') }, { column: 1, body: body('B') }] },
        { height: 1000, cells: [{ column: 1, body: body('C') }] },
      ],
    }

    expect(layoutTable(table).cells[0]?.bounds).toEqual({ x: 0, y: 0, w: 1000, h: 1800 })
  })

  it('keeps empty cells addressable', () => {
    const table: TableElement = {
      id: 'tbl_1',
      kind: 'table',
      bounds: { x: 0, y: 0, w: 1000, h: 1000 },
      columns: [1000],
      rows: [{ height: 1000, cells: [{ column: 0, body: body('') }] }],
    }

    expect(layoutTable(table).cells[0]).toMatchObject({ row: 0, column: 0, body: body('') })
  })
})

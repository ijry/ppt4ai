import { describe, expect, it } from 'vitest'
import { resolveTableCellStyle, type TableElement, type TableStyle } from './index'

function table(): TableElement {
  return {
    id: 'tbl_1',
    kind: 'table',
    bounds: { x: 0, y: 0, w: 2000, h: 2000 },
    columns: [1000, 1000],
    rows: [0, 1].map(() => ({ height: 1000, cells: [0, 1].map((column) => ({ column, body: { paragraphs: [{ runs: [] }] } })) })),
    style: { styleId: 'style-1' },
  }
}

const diagonal = { color: { type: 'srgb' as const, v: 'FF0000' }, width: 12700, style: 'solid' as const }

const styles: Record<string, TableStyle> = {
  'style-1': { id: 'style-1', regions: { wholeTable: { borders: { tlToBr: diagonal } } } },
}

function bordersAt(row: number, column: number) {
  const fixture = table()
  const cell = fixture.rows[row]?.cells[column]
  if (!cell) throw new Error('fixture cell missing')
  return resolveTableCellStyle(fixture, cell, row, column, styles).borders
}

describe('table style diagonals', () => {
  /**
   * Unlike `insideH`/`insideV`, a diagonal belongs to the cell rather than to an edge between cells, so
   * every cell of the region gets it — position plays no part.
   */
  it('gives every cell in the region the same diagonal', () => {
    expect(bordersAt(0, 0)).toEqual({ tlToBr: diagonal })
    expect(bordersAt(0, 1)).toEqual({ tlToBr: diagonal })
    expect(bordersAt(1, 0)).toEqual({ tlToBr: diagonal })
    expect(bordersAt(1, 1)).toEqual({ tlToBr: diagonal })
  })

  it('lets a cell\'s own diagonal win over the region\'s', () => {
    const own = { color: { type: 'srgb' as const, v: '00FF00' }, style: 'dash' as const }
    const fixture = table()
    const cell = fixture.rows[0]?.cells[0]
    if (!cell) throw new Error('fixture cell missing')
    cell.borders = { tlToBr: own }

    expect(resolveTableCellStyle(fixture, cell, 0, 0, styles).borders).toEqual({ tlToBr: own })
  })
})

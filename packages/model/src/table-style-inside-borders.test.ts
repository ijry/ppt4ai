import { describe, expect, it } from 'vitest'
import { resolveTableCellStyle, type TableElement, type TableStyle, type TableStyleBorders } from './index'

function emptyBody() {
  return { paragraphs: [{ runs: [] }] }
}

/** A 3×3 grid, so a cell can be on an outer edge on one axis and interior on the other. */
function table(): TableElement {
  return {
    id: 'tbl_1',
    kind: 'table',
    bounds: { x: 0, y: 0, w: 3000, h: 3000 },
    columns: [1000, 1000, 1000],
    rows: [0, 1, 2].map(() => ({ height: 1000, cells: [0, 1, 2].map((column) => ({ column, body: emptyBody() })) })),
    style: { styleId: 'style-1' },
  }
}

function styleWith(borders: TableStyleBorders): Record<string, TableStyle> {
  return { 'style-1': { id: 'style-1', regions: { wholeTable: { borders } } } }
}

function bordersAt(styles: Record<string, TableStyle>, row: number, column: number) {
  const fixture = table()
  const cell = fixture.rows[row]?.cells[column]
  if (!cell) throw new Error('fixture cell missing')
  return resolveTableCellStyle(fixture, cell, row, column, styles).borders
}

const interiorLine = { color: { type: 'srgb' as const, v: '111111' }, width: 1000, style: 'solid' as const }
const outerLine = { color: { type: 'srgb' as const, v: 'FF0000' }, width: 3000, style: 'solid' as const }

describe('table style inside borders', () => {
  it('lands the interior lines only on the edges a cell shares with a neighbour', () => {
    const styles = styleWith({ insideH: interiorLine, insideV: interiorLine })

    expect(bordersAt(styles, 1, 1)).toEqual({ top: interiorLine, bottom: interiorLine, left: interiorLine, right: interiorLine })
    expect(bordersAt(styles, 0, 0)).toEqual({ bottom: interiorLine, right: interiorLine })
    expect(bordersAt(styles, 2, 2)).toEqual({ top: interiorLine, left: interiorLine })
    expect(bordersAt(styles, 0, 1)).toEqual({ bottom: interiorLine, left: interiorLine, right: interiorLine })
  })

  /**
   * The only reading that leaves both elements meaningful: a region's `bottom` describes the region's
   * lower edge, so an interior cell takes the interior line instead.
   */
  it('gives the interior line precedence on an interior edge and the outer side on the outer edge', () => {
    const styles = styleWith({ bottom: outerLine, insideH: interiorLine })

    expect(bordersAt(styles, 0, 0).bottom).toEqual(interiorLine)
    expect(bordersAt(styles, 1, 0).bottom).toEqual(interiorLine)
    expect(bordersAt(styles, 2, 0).bottom).toEqual(outerLine)
  })

  /** A style stating neither interior line resolves exactly as it did before they were modeled. */
  it('leaves a four-sided region alone', () => {
    const styles = styleWith({ bottom: outerLine })

    expect(bordersAt(styles, 0, 0)).toEqual({ bottom: outerLine })
    expect(bordersAt(styles, 1, 1)).toEqual({ bottom: outerLine })
    expect(bordersAt(styles, 2, 2)).toEqual({ bottom: outerLine })
  })

  it('keeps a cell\'s own border above anything the style says', () => {
    const fixture = table()
    const cell = fixture.rows[1]?.cells[1]
    if (!cell) throw new Error('fixture cell missing')
    cell.borders = { top: outerLine }

    expect(resolveTableCellStyle(fixture, cell, 1, 1, styleWith({ insideH: interiorLine })).borders)
      .toEqual({ top: outerLine, bottom: interiorLine })
  })

  it('applies the interior lines of a banded region too', () => {
    const banded: Record<string, TableStyle> = {
      'style-1': { id: 'style-1', regions: { band1H: { borders: { insideV: interiorLine } } } },
    }
    const fixture = table()
    fixture.style = { styleId: 'style-1', bandRow: true }
    const cell = fixture.rows[0]?.cells[1]
    if (!cell) throw new Error('fixture cell missing')

    expect(resolveTableCellStyle(fixture, cell, 0, 1, banded).borders).toEqual({ left: interiorLine, right: interiorLine })
  })
})

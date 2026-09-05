import type { Rect, TableBorder, TableCellBorders, TableElement, TextBody } from '@ppt4ai/model'

export interface TableLayoutCell {
  row: number
  column: number
  rowSpan: number
  colSpan: number
  bounds: Rect
  body: TextBody
  fill?: TableElement['fill']
  borders: TableCellBorders
}

export interface TableLayoutBorder {
  side: 'left' | 'right' | 'top' | 'bottom' | 'tlToBr' | 'blToTr'
  from: number
  to: number
  border: TableBorder
}

export interface TableLayout {
  bounds: Rect
  columns: number[]
  rows: number[]
  cells: TableLayoutCell[]
  borders: TableLayoutBorder[]
}

/**
 * The diagonals are absent on purpose: an entry here is a segment along one axis (`from`/`to` on the
 * other coordinate), which a corner-to-corner line has no form for. Painting reads a cell's own borders
 * and its rect, so it draws the diagonals without needing an entry.
 */
const borderSides: Array<keyof TableCellBorders> = ['left', 'right', 'top', 'bottom']

function cumulativeOffsets(values: number[], origin: number): number[] {
  const offsets = [origin]
  for (const value of values) offsets.push(offsets[offsets.length - 1]! + value)
  return offsets
}

export function layoutTable(element: TableElement): TableLayout {
  const columnOffsets = cumulativeOffsets(element.columns, element.bounds.x)
  const rowOffsets = cumulativeOffsets(element.rows.map((row) => row.height), element.bounds.y)
  const cells: TableLayoutCell[] = []
  const borders: TableLayoutBorder[] = []

  element.rows.forEach((row, rowIndex) => {
    row.cells.forEach((cell) => {
      const rowSpan = cell.rowSpan ?? 1
      const colSpan = cell.colSpan ?? 1
      const startX = columnOffsets[cell.column] ?? element.bounds.x
      const endX = columnOffsets[cell.column + colSpan] ?? startX
      const startY = rowOffsets[rowIndex] ?? element.bounds.y
      const endY = rowOffsets[rowIndex + rowSpan] ?? startY
      const bounds = { x: startX, y: startY, w: endX - startX, h: endY - startY }
      cells.push({
        row: rowIndex,
        column: cell.column,
        rowSpan,
        colSpan,
        bounds,
        body: structuredClone(cell.body),
        ...(cell.fill ? { fill: structuredClone(cell.fill) } : {}),
        borders: structuredClone(cell.borders ?? {}),
      })

      for (const side of borderSides) {
        const border = cell.borders?.[side]
        if (!border) continue
        const vertical = side === 'left' || side === 'right'
        borders.push({
          side,
          from: vertical ? startY : startX,
          to: vertical ? endY : endX,
          border: structuredClone(border),
        })
      }
    })
  })

  return {
    bounds: { ...element.bounds },
    columns: [...element.columns],
    rows: element.rows.map((row) => row.height),
    cells,
    borders,
  }
}

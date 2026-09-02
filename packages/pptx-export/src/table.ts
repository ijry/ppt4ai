import type {
  TableBorder,
  TableCell,
  TableCellBorders,
  TableElement,
} from '@ppt4ai/model'
import { attrs, booleanAttribute, serializeFillXml, serializeTextBodyXml } from './text-xml.js'

const namespace = 'http://schemas.openxmlformats.org/drawingml/2006/main'

function serializeBorder(name: string, border: TableBorder | undefined): string {
  if (!border) return ''
  if (border.style === 'none') return `<a:${name}${attrs([['w', border.width]])}><a:noFill/></a:${name}>`
  const dash = border.style === 'dash' || border.style === 'dot'
    ? `<a:prstDash${attrs([['val', border.style]])}/>`
    : ''
  return `<a:${name}${attrs([['w', border.width]])}>${serializeFillXml({ color: border.color })}${dash}</a:${name}>`
}

function serializeBorders(borders: TableCellBorders | undefined): string {
  if (!borders) return ''
  return serializeBorder('lnL', borders.left)
    + serializeBorder('lnR', borders.right)
    + serializeBorder('lnT', borders.top)
    + serializeBorder('lnB', borders.bottom)
}

function serializeCellProperties(cell: TableCell, continuation: 'horizontal' | 'vertical' | undefined): string {
  const properties = attrs([
    ['gridSpan', !continuation && cell.colSpan && cell.colSpan > 1 ? cell.colSpan : undefined],
    ['rowSpan', !continuation && cell.rowSpan && cell.rowSpan > 1 ? cell.rowSpan : undefined],
    ['hMerge', continuation === 'horizontal' ? '1' : undefined],
    ['vMerge', continuation === 'vertical' ? '1' : undefined],
  ])
  const content = continuation ? '' : serializeFillXml(cell.fill) + serializeBorders(cell.borders)
  return content ? `<a:tcPr${properties}>${content}</a:tcPr>` : `<a:tcPr${properties}/>`
}

function emptyCell(): TableCell {
  return { column: 0, body: { paragraphs: [{ runs: [] }] } }
}

function serializeCell(cell: TableCell, continuation: 'horizontal' | 'vertical' | undefined): string {
  const body = continuation ? serializeTextBodyXml(emptyCell().body, 'a:') : serializeTextBodyXml(cell.body, 'a:')
  return `<a:tc>${body}${serializeCellProperties(cell, continuation)}</a:tc>`
}

function serializeRow(table: TableElement, rowIndex: number): string {
  const row = table.rows[rowIndex]
  if (!row) return ''
  const origins = new Map<number, TableCell>()
  for (const cell of row.cells) origins.set(cell.column, cell)
  const previousOrigins = new Map<number, { cell: TableCell; row: number }>()
  for (let priorRow = 0; priorRow < rowIndex; priorRow += 1) {
    for (const cell of table.rows[priorRow]?.cells ?? []) {
      const rowSpan = cell.rowSpan ?? 1
      const colSpan = cell.colSpan ?? 1
      if (priorRow + rowSpan > rowIndex) {
        for (let column = cell.column; column < cell.column + colSpan; column += 1) previousOrigins.set(column, { cell, row: priorRow })
      }
    }
  }
  const cells: string[] = []
  let column = 0
  while (column < table.columns.length) {
    const origin = origins.get(column)
    if (origin) {
      const colSpan = origin.colSpan ?? 1
      cells.push(serializeCell(origin, undefined))
      column += colSpan
      continue
    }
    const previous = previousOrigins.get(column)
    if (previous && previous.cell.column === column) {
      const colSpan = previous.cell.colSpan ?? 1
      cells.push(serializeCell(previous.cell, 'vertical'))
      column += colSpan
      continue
    }
    cells.push(serializeCell(emptyCell(), undefined))
    column += 1
  }
  return `<a:tr${attrs([['h', row.height]])}>${cells.join('')}</a:tr>`
}

function serializeTableProperties(table: TableElement): string {
  const style = table.style
  return `<a:tblPr${attrs([
    ['tableStyleId', style?.styleId],
    ['firstRow', booleanAttribute(style?.firstRow)],
    ['lastRow', booleanAttribute(style?.lastRow)],
    ['firstCol', booleanAttribute(style?.firstColumn)],
    ['lastCol', booleanAttribute(style?.lastColumn)],
    ['bandRow', booleanAttribute(style?.bandRow)],
    ['bandCol', booleanAttribute(style?.bandColumn)],
  ])}>${serializeFillXml(table.fill)}</a:tblPr>`
}

export function serializeTableXml(table: TableElement): string {
  const grid = `<a:tblGrid>${table.columns.map((width) => `<a:gridCol${attrs([['w', width]])}/>`).join('')}</a:tblGrid>`
  return `<a:tbl xmlns:a="${namespace}">${serializeTableProperties(table)}${grid}${table.rows.map((_, rowIndex) => serializeRow(table, rowIndex)).join('')}</a:tbl>`
}

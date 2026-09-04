import type {
  PictureFill,
  TableBorder,
  TableCell,
  TableCellBorders,
  TableElement,
} from '@ppt4ai/model'
import { attrs, booleanAttribute, escapeXml, serializeFillXml, serializeTextBodyXml } from './text-xml.js'

/**
 * Maps an asset to the relationship that already points at it. A cell's picture fill can only be written
 * when the caller supplies one: this serializer rebuilds the whole `a:tbl`, so on the source-package path
 * the ids come from the table it is replacing, and on the standalone path from the freshly allocated ones.
 */
export type TablePictureRelationships = (assetId: string) => string | undefined

const namespace = 'http://schemas.openxmlformats.org/drawingml/2006/main'

function serializeBorder(name: string, border: TableBorder | undefined): string {
  if (!border) return ''
  if (border.style === 'none') return `<a:${name}${attrs([['w', border.width]])}><a:noFill/></a:${name}>`
  // Every token except `solid` writes verbatim; `solid` is the default and stays implicit.
  const dash = border.style !== undefined && border.style !== 'solid'
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

function serializeCellPictureFill(fill: PictureFill | undefined, relationships: TablePictureRelationships | undefined): string {
  const relationshipId = fill && relationships?.(fill.assetId)
  if (!fill || !relationshipId) return ''
  const effects = (fill.effects ?? []).map((effect) => effect.type === 'grayscl'
    ? '<a:grayscl/>'
    : `<a:alphaModFix amt="${effect.amount}"/>`).join('')
  const blip = effects
    ? `<a:blip r:embed="${escapeXml(relationshipId)}">${effects}</a:blip>`
    : `<a:blip r:embed="${escapeXml(relationshipId)}"/>`
  const crop = fill.sourceCrop
  const cropAttributes = crop
    ? attrs([['l', crop.left], ['t', crop.top], ['r', crop.right], ['b', crop.bottom]])
    : ''
  const sourceRect = crop ? `<a:srcRect${cropAttributes}/>` : ''
  const tile = fill.tile
  const mode = tile
    ? `<a:tile${attrs([['tx', tile.offsetX], ['ty', tile.offsetY], ['sx', tile.scaleX], ['sy', tile.scaleY], ['flip', tile.flip], ['algn', tile.align]])}/>`
    : `<a:stretch><a:fillRect${fill.stretch ? attrs([['l', fill.stretch.left], ['t', fill.stretch.top], ['r', fill.stretch.right], ['b', fill.stretch.bottom]]) : ''}/></a:stretch>`
  return `<a:blipFill>${blip}${sourceRect}${mode}</a:blipFill>`
}

function serializeCellProperties(
  cell: TableCell,
  continuation: 'horizontal' | 'vertical' | undefined,
  relationships: TablePictureRelationships | undefined,
): string {
  const properties = attrs([
    ['gridSpan', !continuation && cell.colSpan && cell.colSpan > 1 ? cell.colSpan : undefined],
    ['rowSpan', !continuation && cell.rowSpan && cell.rowSpan > 1 ? cell.rowSpan : undefined],
    ['hMerge', continuation === 'horizontal' ? '1' : undefined],
    ['vMerge', continuation === 'vertical' ? '1' : undefined],
  ])
  // One fill per cell: the picture replaces the colour, as it does on shapes and slide backgrounds.
  const picture = continuation ? '' : serializeCellPictureFill(cell.pictureFill, relationships)
  const content = continuation ? '' : (picture || serializeFillXml(cell.fill)) + serializeBorders(cell.borders)
  return content ? `<a:tcPr${properties}>${content}</a:tcPr>` : `<a:tcPr${properties}/>`
}

function emptyCell(): TableCell {
  return { column: 0, body: { paragraphs: [{ runs: [] }] } }
}

function serializeCell(
  cell: TableCell,
  continuation: 'horizontal' | 'vertical' | undefined,
  relationships: TablePictureRelationships | undefined,
): string {
  const body = continuation ? serializeTextBodyXml(emptyCell().body, 'a:') : serializeTextBodyXml(cell.body, 'a:')
  return `<a:tc>${body}${serializeCellProperties(cell, continuation, relationships)}</a:tc>`
}

function serializeRow(table: TableElement, rowIndex: number, relationships: TablePictureRelationships | undefined): string {
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
      cells.push(serializeCell(origin, undefined, relationships))
      column += colSpan
      continue
    }
    const previous = previousOrigins.get(column)
    if (previous && previous.cell.column === column) {
      const colSpan = previous.cell.colSpan ?? 1
      cells.push(serializeCell(previous.cell, 'vertical', relationships))
      column += colSpan
      continue
    }
    cells.push(serializeCell(emptyCell(), undefined, relationships))
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

export function serializeTableXml(table: TableElement, relationships?: TablePictureRelationships): string {
  const grid = `<a:tblGrid>${table.columns.map((width) => `<a:gridCol${attrs([['w', width]])}/>`).join('')}</a:tblGrid>`
  return `<a:tbl xmlns:a="${namespace}">${serializeTableProperties(table)}${grid}${table.rows.map((_, rowIndex) => serializeRow(table, rowIndex, relationships)).join('')}</a:tbl>`
}

import type { SceneTableLayoutCell, SceneTableNode } from '@ppt4ai/render'
import { layoutRectToScreen, type TextViewportTransform } from './text-editor-interaction'

export interface TableCellPoint { row: number; column: number }
export interface TableCellSelection { anchor: TableCellPoint; focus: TableCellPoint }
export interface TableEditorCell {
  point: TableCellPoint
  rowSpan: number
  colSpan: number
  rect: { x: number; y: number; width: number; height: number }
}
export interface TableEditorOverlayModel {
  bounds: { x: number; y: number; width: number; height: number }
  cells: TableEditorCell[]
}

function assertFinitePositiveRect(rect: { x: number; y: number; w: number; h: number }, name: string): void {
  if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) throw new Error(`${name} must be finite`)
  if (rect.w <= 0 || rect.h <= 0) throw new Error(`${name} must be positive`)
}

function assertCell(cell: SceneTableLayoutCell): void {
  assertFinitePositiveRect(cell.bounds, 'cell bounds')
  if (![cell.row, cell.column, cell.rowSpan, cell.colSpan].every(Number.isInteger)) {
    throw new Error('cell coordinates and spans must be integers')
  }
  if (cell.row < 0 || cell.column < 0) throw new Error('cell coordinates must be non-negative')
  if (cell.rowSpan <= 0 || cell.colSpan <= 0) throw new Error('cell spans must be positive')
}

function pointInRect(
  point: { x: number; y: number },
  rect: TableEditorCell['rect'],
  isLast: boolean,
  cells: TableEditorCell[],
): boolean {
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  const maxRight = Math.max(...cells.map((cell) => cell.rect.x + cell.rect.width))
  const maxBottom = Math.max(...cells.map((cell) => cell.rect.y + cell.rect.height))
  return point.x >= rect.x && point.y >= rect.y
    && (point.x < right || (isLast && right === maxRight))
    && (point.y < bottom || (isLast && bottom === maxBottom))
}

export function createTableEditorOverlay(table: SceneTableNode, transform: TextViewportTransform): TableEditorOverlayModel {
  assertFinitePositiveRect(table.bounds, 'table bounds')
  return {
    bounds: layoutRectToScreen({ x: table.bounds.x, y: table.bounds.y, width: table.bounds.w, height: table.bounds.h }, transform),
    cells: table.layout.cells.map((cell) => {
      assertCell(cell)
      return {
        point: { row: cell.row, column: cell.column },
        rowSpan: cell.rowSpan,
        colSpan: cell.colSpan,
        rect: layoutRectToScreen({ x: cell.bounds.x, y: cell.bounds.y, width: cell.bounds.w, height: cell.bounds.h }, transform),
      }
    }),
  }
}

export function tableCellAtPoint(model: TableEditorOverlayModel, point: { x: number; y: number }): TableEditorCell | undefined {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('point must be finite')
  return model.cells.find((cell, index) => pointInRect(point, cell.rect, index === model.cells.length - 1, model.cells))
}

export function selectedTableCells(cells: TableEditorCell[], selection: TableCellSelection): TableEditorCell[] {
  const minRow = Math.min(selection.anchor.row, selection.focus.row)
  const maxRow = Math.max(selection.anchor.row, selection.focus.row)
  const minColumn = Math.min(selection.anchor.column, selection.focus.column)
  const maxColumn = Math.max(selection.anchor.column, selection.focus.column)
  const seen = new Set<string>()
  return cells.filter((cell) => {
    const rowEnd = cell.point.row + cell.rowSpan - 1
    const columnEnd = cell.point.column + cell.colSpan - 1
    const intersects = cell.point.row <= maxRow && rowEnd >= minRow && cell.point.column <= maxColumn && columnEnd >= minColumn
    const key = `${cell.point.row}:${cell.point.column}`
    if (!intersects || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

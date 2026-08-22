import type { EditorEngine, EngineState } from '@ppt4ai/engine'
import type { TableCellPoint, TableCellSelection } from './table-editor-overlay'

export interface TableEditorControllerOptions {
  engine: EditorEngine
  elementId: string
}

export interface TableEditorController {
  getState(): EngineState
  select(selection: TableCellSelection): EngineState
  selectEnd(selection: TableCellSelection): EngineState
}

function assertPoint(point: TableCellPoint, name: 'anchor' | 'focus'): void {
  if (![point.row, point.column].every((value) => Number.isFinite(value) && Number.isInteger(value))) {
    throw new Error(`table cell coordinate must use finite integers: ${name}[${point.row},${point.column}]`)
  }
}

function assertSelection(selection: TableCellSelection): void {
  assertPoint(selection.anchor, 'anchor')
  assertPoint(selection.focus, 'focus')
}

function samePoint(left: TableCellPoint, right: TableCellPoint): boolean {
  return left.row === right.row && left.column === right.column
}

export function createTableEditorController(options: TableEditorControllerOptions): TableEditorController {
  if (options.elementId.length === 0) throw new Error('elementId must be non-empty')

  const dispatchAnchor = (selection: TableCellSelection): EngineState => options.engine.dispatch({
    type: 'selectTableCell',
    elementId: options.elementId,
    row: selection.anchor.row,
    column: selection.anchor.column,
    extend: false,
  })

  return {
    getState: () => options.engine.getState(),
    select(selection): EngineState {
      assertSelection(selection)
      return dispatchAnchor(selection)
    },
    selectEnd(selection): EngineState {
      assertSelection(selection)
      const anchorState = dispatchAnchor(selection)
      if (samePoint(selection.anchor, selection.focus)) return anchorState
      return options.engine.dispatch({
        type: 'selectTableCell',
        elementId: options.elementId,
        row: selection.focus.row,
        column: selection.focus.column,
        extend: true,
      })
    },
  }
}

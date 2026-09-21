import type { EditorEngine, EngineState } from '@ppt4ai/engine'
import type { TextBody } from '@ppt4ai/model'
import type { TableCellPoint } from './table-editor-overlay'

export interface TableCellTextEditingControllerOptions {
  engine: EditorEngine
  elementId: string
}

export interface TableCellTextEditingController {
  getState(): EngineState
  commitText(point: TableCellPoint, body: TextBody): EngineState
  cancelText(): EngineState
}

function assertPoint(point: TableCellPoint): void {
  if (![point.row, point.column].every((value) => Number.isFinite(value) && Number.isInteger(value))) {
    throw new Error(`table cell coordinate must use finite integers: text[${point.row},${point.column}]`)
  }
}

export function createTableCellTextEditingController(
  options: TableCellTextEditingControllerOptions,
): TableCellTextEditingController {
  if (options.elementId.length === 0) throw new Error('elementId must be non-empty')

  return {
    getState: () => options.engine.getState(),
    commitText(point, body): EngineState {
      assertPoint(point)
      options.engine.dispatch({
        type: 'selectTableCell',
        elementId: options.elementId,
        row: point.row,
        column: point.column,
        extend: false,
      })
      return options.engine.dispatch({ type: 'setTableCellText', body: structuredClone(body) })
    },
    cancelText: () => options.engine.getState(),
  }
}

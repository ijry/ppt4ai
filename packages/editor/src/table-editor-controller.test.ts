import { describe, expect, it } from 'vitest'
import { EditorEngine } from '@ppt4ai/engine'
import type { Ppt4aiDocument } from '@ppt4ai/model'
import { createTableEditorController } from './table-editor-controller'

function makeTableDocument(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'doc_table_controller',
    page: { w: 120, h: 80 },
    slides: {
      slide_1: { id: 'slide_1', elementIds: ['el_table'] },
    },
    slideOrder: ['slide_1'],
    elements: {
      el_table: {
        id: 'el_table',
        kind: 'table',
        bounds: { x: 0, y: 0, w: 120, h: 80 },
        columns: [60, 60],
        rows: [
          { height: 40, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'A' }] }] }, rowSpan: 1, colSpan: 2 }] },
          { height: 40, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'B' }] }] } }, { column: 1, body: { paragraphs: [{ runs: [{ text: 'C' }] }] } }] },
        ],
      },
    },
  }
}

describe('createTableEditorController', () => {
  it('maps a click to one non-history engine selection command', () => {
    const engine = new EditorEngine(makeTableDocument())
    const controller = createTableEditorController({ engine, elementId: 'el_table' })

    expect(controller.select({ anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } })).toMatchObject({
      tableCellSelection: {
        elementId: 'el_table',
        anchorRow: 1,
        anchorColumn: 1,
        row: 1,
        column: 1,
      },
      history: { undoDepth: 0, redoDepth: 0 },
    })
  })

  it('maps a reverse drag to an inclusive anchor and focus range', () => {
    const engine = new EditorEngine(makeTableDocument())
    const controller = createTableEditorController({ engine, elementId: 'el_table' })

    expect(controller.selectEnd({ anchor: { row: 1, column: 1 }, focus: { row: 0, column: 0 } }).tableCellSelection).toEqual({
      elementId: 'el_table',
      anchorRow: 1,
      anchorColumn: 1,
      row: 0,
      column: 0,
    })
  })

  it('delegates merged-cell coordinate normalization to the engine', () => {
    const engine = new EditorEngine(makeTableDocument())
    const controller = createTableEditorController({ engine, elementId: 'el_table' })

    expect(controller.select({ anchor: { row: 0, column: 1 }, focus: { row: 0, column: 1 } }).tableCellSelection).toMatchObject({
      anchorRow: 0,
      anchorColumn: 0,
      row: 0,
      column: 0,
    })
  })

  it('returns clone-safe state snapshots', () => {
    const engine = new EditorEngine(makeTableDocument())
    const controller = createTableEditorController({ engine, elementId: 'el_table' })
    const state = controller.select({ anchor: { row: 1, column: 0 }, focus: { row: 1, column: 0 } })

    state.tableCellSelection!.row = 99
    expect(controller.getState().tableCellSelection!.row).toBe(1)
  })

  it('rejects invalid coordinates before dispatching', () => {
    const engine = new EditorEngine(makeTableDocument())
    const controller = createTableEditorController({ engine, elementId: 'el_table' })

    expect(() => controller.select({ anchor: { row: 0.5, column: 0 }, focus: { row: 0, column: 0 } })).toThrow(
      'table cell coordinate must use finite integers',
    )
    expect(controller.getState().tableCellSelection).toBeUndefined()
  })

  it('rejects an empty element ID', () => {
    const engine = new EditorEngine(makeTableDocument())

    expect(() => createTableEditorController({ engine, elementId: '' })).toThrow('elementId must be non-empty')
  })

  it('dispatches atomic fill and border edits for the selected range', () => {
    const engine = new EditorEngine(makeTableDocument())
    const controller = createTableEditorController({ engine, elementId: 'el_table' })
    controller.selectEnd({ anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } })
    const fill = { color: { type: 'srgb' as const, v: '00FF00' } }
    const border = { color: { type: 'srgb' as const, v: '0000FF' }, width: 1000, style: 'solid' as const }

    expect(controller.setFill(fill)).toMatchObject({
      document: { elements: { el_table: { rows: [{ cells: [{ fill }] }, { cells: [{ fill }, { fill }] }] } } },
      history: { undoDepth: 1, redoDepth: 0 },
    })
    expect(controller.setBorders({ left: border, bottom: border })).toMatchObject({
      document: { elements: { el_table: { rows: [
        { cells: [{ borders: { left: border, bottom: border } }] },
        { cells: [{ borders: { left: border, bottom: border } }, { borders: { left: border, bottom: border } }] },
      ] } } },
      history: { undoDepth: 2, redoDepth: 0 },
    })
  })

  it('clears explicit formatting and propagates validation errors', () => {
    const engine = new EditorEngine(makeTableDocument())
    const controller = createTableEditorController({ engine, elementId: 'el_table' })
    controller.select({ anchor: { row: 1, column: 0 }, focus: { row: 1, column: 0 } })
    controller.setFill({ color: { type: 'srgb', v: '00FF00' } })
    controller.setBorders({ top: { color: { type: 'srgb', v: '111111' } } })

    controller.setFill(null)
    const cleared = controller.setBorders({ top: null })
    expect(cleared.document.elements.el_table).toMatchObject({ rows: [{}, { cells: [{}, {}] }] })
    const historyDepth = cleared.history.undoDepth
    expect(() => controller.setFill({ color: { type: 'invalid' as never, v: '' } })).toThrow()
    expect(controller.getState().history.undoDepth).toBe(historyDepth)
  })
})

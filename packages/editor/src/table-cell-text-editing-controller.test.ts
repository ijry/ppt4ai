import { EditorEngine } from '@ppt4ai/engine'
import type { Ppt4aiDocument, TextBody } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createTableCellTextEditingController } from './table-cell-text-editing-controller'

function makeTableDocument(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'doc_table_text_controller',
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
          { height: 40, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'Merged' }] }] }, rowSpan: 1, colSpan: 2 }] },
          { height: 40, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'B' }] }] } }, { column: 1, body: { paragraphs: [{ runs: [{ text: 'C' }] }] } }] },
        ],
      },
    },
  }
}

function sourceText(document: Ppt4aiDocument, row: number, cellIndex: number): string | undefined {
  const table = document.elements.el_table
  if (!table || table.kind !== 'table') return undefined
  return table.rows[row]?.cells[cellIndex]?.body.paragraphs[0]?.runs[0]?.text
}

describe('createTableCellTextEditingController', () => {
  it('normalizes a covered merged coordinate and commits one undoable body replacement', () => {
    const engine = new EditorEngine(makeTableDocument())
    const controller = createTableCellTextEditingController({ engine, elementId: 'el_table' })
    const body: TextBody = { paragraphs: [{ runs: [{ text: 'Updated' }] }] }

    const committed = controller.commitText({ row: 0, column: 1 }, body)

    expect(committed.tableCellSelection).toEqual({
      elementId: 'el_table',
      anchorRow: 0,
      anchorColumn: 0,
      row: 0,
      column: 0,
    })
    expect(sourceText(committed.document, 0, 0)).toBe('Updated')
    expect(sourceText(committed.document, 1, 0)).toBe('B')
    expect(committed.history).toEqual({ undoDepth: 1, redoDepth: 0 })

    expect(sourceText(engine.dispatch({ type: 'undo' }).document, 0, 0)).toBe('Merged')
    expect(sourceText(engine.dispatch({ type: 'redo' }).document, 0, 0)).toBe('Updated')
  })

  it('keeps unchanged commits and cancel out of document history', () => {
    const engine = new EditorEngine(makeTableDocument())
    const controller = createTableCellTextEditingController({ engine, elementId: 'el_table' })

    const unchanged = controller.commitText({ row: 0, column: 0 }, { paragraphs: [{ runs: [{ text: 'Merged' }] }] })
    const cancelled = controller.cancelText()

    expect(unchanged.history).toEqual({ undoDepth: 0, redoDepth: 0 })
    expect(cancelled).toEqual(unchanged)
    cancelled.document.id = 'mutated snapshot'
    expect(controller.getState().document.id).toBe('doc_table_text_controller')
  })

  it('clones the committed body before it reaches engine state', () => {
    const engine = new EditorEngine(makeTableDocument())
    const controller = createTableCellTextEditingController({ engine, elementId: 'el_table' })
    const body: TextBody = { paragraphs: [{ runs: [{ text: 'Safe' }] }] }

    controller.commitText({ row: 1, column: 1 }, body)
    body.paragraphs[0]!.runs[0]!.text = 'Mutated'

    expect(sourceText(controller.getState().document, 1, 1)).toBe('Safe')
  })

  it('rejects invalid and stale targets before dispatching text', () => {
    const engine = new EditorEngine(makeTableDocument())
    const controller = createTableCellTextEditingController({ engine, elementId: 'el_table' })
    const before = controller.getState()

    expect(() => controller.commitText({ row: 0.5, column: 0 }, { paragraphs: [{ runs: [] }] })).toThrow(
      'table cell coordinate must use finite integers',
    )
    expect(() => controller.commitText({ row: 99, column: 99 }, { paragraphs: [{ runs: [{ text: 'Wrong' }] }] })).toThrow(
      'table cell coordinate is outside table',
    )
    expect(controller.getState()).toEqual(before)
  })

  it('rejects an empty table element ID', () => {
    expect(() => createTableCellTextEditingController({
      engine: new EditorEngine(makeTableDocument()),
      elementId: '',
    })).toThrow('elementId must be non-empty')
  })
})

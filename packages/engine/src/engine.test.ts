import { describe, expect, it } from 'vitest'
import { EditorEngine } from './index'
import type { Ppt4aiDocument } from '@ppt4ai/model'

function makeDocument(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_engine',
    page: { w: 10000000, h: 6000000 },
    slides: {
      sld_1: { id: 'sld_1', elementIds: ['el_a', 'el_b'] },
    },
    elements: {
      el_a: {
        id: 'el_a',
        kind: 'shape',
        preset: 'rect',
        bounds: { x: 1000000, y: 1000000, w: 1000000, h: 1000000 },
      },
      el_b: {
        id: 'el_b',
        kind: 'shape',
        preset: 'ellipse',
        bounds: { x: 4000000, y: 1000000, w: 1000000, h: 1000000 },
      },
    },
    slideOrder: ['sld_1'],
  }
}

function makeTableDocument(): Ppt4aiDocument {
  const document = makeDocument()
  document.slides.sld_1!.elementIds.push('el_table')
  document.elements.el_table = {
    id: 'el_table',
    kind: 'table',
    bounds: { x: 1000000, y: 3000000, w: 3000000, h: 2000000 },
    columns: [1000000, 2000000],
    rows: [
      { height: 500000, cells: [{ column: 0, colSpan: 2, body: { paragraphs: [{ runs: [{ text: 'Header' }] }] } }] },
      { height: 1500000, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'Left' }] }] } }, { column: 1, body: { paragraphs: [{ runs: [{ text: 'Right' }] }] } }] },
    ],
  }
  return document
}

function makeStructureDocument(): Ppt4aiDocument {
  const document = makeDocument()
  document.slides.sld_1!.elementIds.push('el_table')
  document.elements.el_table = {
    id: 'el_table',
    kind: 'table',
    bounds: { x: 1000, y: 2000, w: 1000, h: 100 },
    columns: [100, 200, 300, 400],
    rows: [
      {
        height: 10,
        cells: [
          {
            column: 0,
            rowSpan: 3,
            colSpan: 2,
            body: { paragraphs: [{ runs: [{ text: 'Merged' }] }] },
            fill: { color: { type: 'srgb', v: 'ABCDEF' } },
            borders: { left: { color: { type: 'srgb', v: '123456' }, width: 100, style: 'solid' } },
          },
          { column: 2, body: { paragraphs: [{ runs: [{ text: 'B' }] }] } },
          { column: 3, body: { paragraphs: [{ runs: [{ text: 'C' }] }] } },
        ],
      },
      { height: 20, cells: [{ column: 2, colSpan: 2, body: { paragraphs: [{ runs: [{ text: 'D' }] }] } }] },
      {
        height: 30,
        cells: [
          { column: 2, body: { paragraphs: [{ runs: [{ text: 'E' }] }] } },
          { column: 3, body: { paragraphs: [{ runs: [{ text: 'F' }] }] } },
        ],
      },
      {
        height: 40,
        cells: [
          { column: 0, body: { paragraphs: [{ runs: [{ text: 'G' }] }] } },
          { column: 1, body: { paragraphs: [{ runs: [{ text: 'H' }] }] } },
          { column: 2, body: { paragraphs: [{ runs: [{ text: 'I' }] }] } },
          { column: 3, body: { paragraphs: [{ runs: [{ text: 'J' }] }] } },
        ],
      },
    ],
  }
  return document
}

describe('EditorEngine', () => {
  it('keeps selection separate from document history and clones state safely', () => {
    const engine = new EditorEngine(makeDocument())

    expect(engine.dispatch({ type: 'select', elementIds: ['el_a'] }).selection).toEqual(['el_a'])
    expect(engine.dispatch({ type: 'undo' }).selection).toEqual(['el_a'])
    expect(engine.getState().history).toEqual({ undoDepth: 0, redoDepth: 0 })
    expect(structuredClone(engine.getState())).toEqual(engine.getState())

    const state = engine.getState()
    state.document.elements.el_a!.bounds.x = 999
    expect(engine.getState().document.elements.el_a!.bounds.x).toBe(1000000)
  })

  it('supports additive selection while deduplicating and filtering missing elements', () => {
    const engine = new EditorEngine(makeDocument())

    expect(engine.dispatch({ type: 'select', elementIds: ['el_a', 'missing'] }).selection).toEqual(['el_a'])
    expect(engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'], additive: true }).selection).toEqual(['el_a', 'el_b'])
  })

  it('selects table cells while keeping element selection separate', () => {
    const engine = new EditorEngine(makeTableDocument())

    const merged = engine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 0, column: 1 })
    expect(merged.selection).toEqual(['el_table'])
    expect(merged.tableCellSelection).toEqual({ elementId: 'el_table', anchorRow: 0, anchorColumn: 0, row: 0, column: 0 })

    expect(engine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 1, column: 1, extend: true }).tableCellSelection).toEqual({
      elementId: 'el_table',
      anchorRow: 0,
      anchorColumn: 0,
      row: 1,
      column: 1,
    })
    expect(structuredClone(engine.getState())).toEqual(engine.getState())
  })

  it('resets table cell anchors and clears cell selection for element selection', () => {
    const document = makeTableDocument()
    document.slides.sld_1!.elementIds.push('el_table_2')
    document.elements.el_table_2 = structuredClone(document.elements.el_table!)
    document.elements.el_table_2.id = 'el_table_2'
    const engine = new EditorEngine(document)

    engine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 0, column: 0 })
    expect(engine.dispatch({ type: 'selectTableCell', elementId: 'el_table_2', row: 1, column: 1, extend: true }).tableCellSelection).toEqual({
      elementId: 'el_table_2',
      anchorRow: 1,
      anchorColumn: 1,
      row: 1,
      column: 1,
    })
    expect(engine.dispatch({ type: 'select', elementIds: ['el_a'] }).tableCellSelection).toBeUndefined()
  })

  it('rejects invalid table cell coordinates without changing state', () => {
    const engine = new EditorEngine(makeTableDocument())
    const before = engine.getState()

    expect(() => engine.dispatch({ type: 'selectTableCell', elementId: 'el_a', row: 0, column: 0 })).toThrow('element is not a table: el_a')
    expect(() => engine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: -1, column: 0 })).toThrow('table cell coordinate is outside table: el_table[-1,0]')
    expect(() => engine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 0.5, column: 0 })).toThrow('table cell coordinate must use integers: el_table[0.5,0]')
    expect(engine.getState()).toEqual(before)
  })

  it('replaces selected table cell text with validated clone-safe history', () => {
    const engine = new EditorEngine(makeTableDocument())
    engine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 1, column: 1 })
    const body = { paragraphs: [{ runs: [{ text: 'Updated' }] }] }

    const updated = engine.dispatch({ type: 'setTableCellText', body })
    expect(updated.document.elements.el_table).toMatchObject({
      rows: [
        {},
        { cells: [{}, { body }] } as never,
      ],
    })
    expect(updated.history).toEqual({ undoDepth: 1, redoDepth: 0 })
    body.paragraphs[0]!.runs[0]!.text = 'Mutated'
    expect(engine.getState().document.elements.el_table).toMatchObject({ rows: [{}, { cells: [{}, { body: { paragraphs: [{ runs: [{ text: 'Updated' }] }] } }] }] })

    expect(engine.dispatch({ type: 'undo' }).document.elements.el_table).toMatchObject({ rows: [{}, { cells: [{}, { body: { paragraphs: [{ runs: [{ text: 'Right' }] }] } }] }] })
    expect(engine.dispatch({ type: 'redo' }).document.elements.el_table).toMatchObject({ rows: [{}, { cells: [{}, { body: { paragraphs: [{ runs: [{ text: 'Updated' }] }] } }] }] })
  })

  it('rejects invalid table cell text without changing document or history', () => {
    const engine = new EditorEngine(makeTableDocument())
    engine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 1, column: 1 })
    const before = engine.getState()

    expect(() => engine.dispatch({ type: 'setTableCellText', body: { paragraphs: [] } })).toThrow('table cell body is invalid:')
    expect(engine.getState()).toEqual(before)
    expect(new EditorEngine(makeTableDocument()).dispatch({ type: 'setTableCellText', body: { paragraphs: [{ runs: [{ text: 'Ignored' }] }] } }).history).toEqual({ undoDepth: 0, redoDepth: 0 })
  })

  it('applies fill and independent borders to the selected cell range atomically', () => {
    const engine = new EditorEngine(makeTableDocument())
    engine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 0, column: 0 })
    engine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 1, column: 1, extend: true })

    const fill = { color: { type: 'srgb' as const, v: '00FF00' } }
    const withFill = engine.dispatch({ type: 'setTableCellFill', fill })
    expect(withFill.document.elements.el_table).toMatchObject({
      rows: [
        { cells: [{ fill },] },
        { cells: [{ fill }, { fill }] },
      ],
    })
    expect(withFill.history).toEqual({ undoDepth: 1, redoDepth: 0 })

    const border = { color: { type: 'srgb' as const, v: '0000FF' }, width: 1000, style: 'solid' as const }
    const withBorder = engine.dispatch({ type: 'setTableCellBorders', borders: { left: border, bottom: border } })
    expect(withBorder.document.elements.el_table).toMatchObject({
      rows: [
        { cells: [{ borders: { left: border, bottom: border } }] },
        { cells: [{ borders: { left: border, bottom: border } }, { borders: { left: border, bottom: border } }] },
      ],
    })
    expect(withBorder.history).toEqual({ undoDepth: 2, redoDepth: 0 })

    const cleared = engine.dispatch({ type: 'setTableCellFill', fill: null })
    expect(cleared.document.elements.el_table).toMatchObject({ rows: [{ cells: [{}] }, { cells: [{}, {}] }] })
    expect(engine.dispatch({ type: 'undo' }).document.elements.el_table).toMatchObject({ rows: [{ cells: [{}] }, { cells: [{ fill }, { fill }] }] })
    expect(engine.dispatch({ type: 'redo' }).document.elements.el_table).toMatchObject({ rows: [{ cells: [{}] }, { cells: [{}, {}] }] })
  })

  it('preserves unmentioned borders and rejects invalid style payloads', () => {
    const engine = new EditorEngine(makeTableDocument())
    engine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 1, column: 0 })
    const before = engine.getState()
    const border = { color: { type: 'srgb' as const, v: '111111' }, width: 500, style: 'dash' as const }

    expect(engine.dispatch({ type: 'setTableCellBorders', borders: { top: border } }).document.elements.el_table).toMatchObject({ rows: [{}, { cells: [{ borders: { top: border } }, {}] }] })
    expect(engine.dispatch({ type: 'setTableCellBorders', borders: { left: null } }).document.elements.el_table).toMatchObject({ rows: [{}, { cells: [{ borders: { top: border } }, {}] }] })
    const historyDepth = engine.getState().history.undoDepth
    expect(() => engine.dispatch({ type: 'setTableCellFill', fill: { color: { type: 'invalid' as never, v: '' } } })).toThrow()
    expect(() => engine.dispatch({ type: 'setTableCellBorders', borders: { right: { color: { type: 'invalid' as never, v: '' } } } })).toThrow()
    expect(engine.getState().history.undoDepth).toBe(historyDepth)
    expect(engine.dispatch({ type: 'undo' }).document).toEqual(before.document)
  })

  it('inserts rows and columns while preserving merged coverage and dimensions', () => {
    const rowEngine = new EditorEngine(makeStructureDocument())
    const withRow = rowEngine.dispatch({ type: 'insertTableRow', elementId: 'el_table', index: 1 })
    const rowTable = withRow.document.elements.el_table
    expect(rowTable).toMatchObject({ bounds: { x: 1000, y: 2000, w: 1000, h: 120 } })
    expect(rowTable?.kind).toBe('table')
    if (rowTable?.kind !== 'table') throw new Error('expected table')
    expect(rowTable.rows).toHaveLength(5)
    expect(rowTable.rows[0]?.cells[0]).toMatchObject({ column: 0, rowSpan: 4, colSpan: 2 })
    expect(rowTable.rows[1]).toMatchObject({ height: 20, cells: [
      { column: 2, body: { paragraphs: [{ runs: [] }] } },
      { column: 3, body: { paragraphs: [{ runs: [] }] } },
    ] })
    expect(rowTable.rows[2]).toMatchObject({ height: 20, cells: [{ column: 2, colSpan: 2 }] })

    const columnEngine = new EditorEngine(makeStructureDocument())
    const withColumns = columnEngine.dispatch({ type: 'insertTableColumn', elementId: 'el_table', index: 1, count: 2 })
    const columnTable = withColumns.document.elements.el_table
    expect(columnTable).toMatchObject({ bounds: { x: 1000, y: 2000, w: 1400, h: 100 }, columns: [100, 200, 200, 200, 300, 400] })
    expect(columnTable?.kind).toBe('table')
    if (columnTable?.kind !== 'table') throw new Error('expected table')
    expect(columnTable.rows[0]).toMatchObject({ cells: [
      { column: 0, rowSpan: 3, colSpan: 4 },
      { column: 4 },
      { column: 5 },
    ] })
    expect(columnTable.rows[1]).toMatchObject({ cells: [{ column: 4, colSpan: 2 }] })
    expect(columnTable.rows[3]).toMatchObject({ cells: [
      { column: 0 },
      { column: 1, body: { paragraphs: [{ runs: [] }] } },
      { column: 2, body: { paragraphs: [{ runs: [] }] } },
      { column: 3 },
      { column: 4 },
      { column: 5 },
    ] })
  })

  it('deletes merged source rows and columns while migrating payloads', () => {
    const rowEngine = new EditorEngine(makeStructureDocument())
    const withoutSourceRow = rowEngine.dispatch({ type: 'deleteTableRow', elementId: 'el_table', index: 0 })
    const rowDeletedTable = withoutSourceRow.document.elements.el_table
    expect(rowDeletedTable).toMatchObject({ bounds: { x: 1000, y: 2000, w: 1000, h: 90 } })
    expect(rowDeletedTable?.kind).toBe('table')
    if (rowDeletedTable?.kind !== 'table') throw new Error('expected table')
    expect(rowDeletedTable.rows).toHaveLength(3)
    expect(rowDeletedTable.rows[0]).toMatchObject({ cells: [
      {
        column: 0,
        rowSpan: 2,
        colSpan: 2,
        body: { paragraphs: [{ runs: [{ text: 'Merged' }] }] },
        fill: { color: { type: 'srgb', v: 'ABCDEF' } },
        borders: { left: { color: { type: 'srgb', v: '123456' }, width: 100, style: 'solid' } },
      },
      { column: 2, colSpan: 2 },
    ] })

    const columnEngine = new EditorEngine(makeStructureDocument())
    const withoutSourceColumn = columnEngine.dispatch({ type: 'deleteTableColumn', elementId: 'el_table', index: 0 })
    const columnDeletedTable = withoutSourceColumn.document.elements.el_table
    expect(columnDeletedTable).toMatchObject({ bounds: { x: 1000, y: 2000, w: 900, h: 100 }, columns: [200, 300, 400] })
    expect(columnDeletedTable?.kind).toBe('table')
    if (columnDeletedTable?.kind !== 'table') throw new Error('expected table')
    expect(columnDeletedTable.rows[0]).toMatchObject({ cells: [
      {
        column: 0,
        rowSpan: 3,
        body: { paragraphs: [{ runs: [{ text: 'Merged' }] }] },
        fill: { color: { type: 'srgb', v: 'ABCDEF' } },
        borders: { left: { color: { type: 'srgb', v: '123456' }, width: 100, style: 'solid' } },
      },
      { column: 1 },
      { column: 2 },
    ] })
    expect(() => new EditorEngine(makeStructureDocument()).dispatch({ type: 'deleteTableRow', elementId: 'el_table', index: 0, count: 4 })).toThrow('table must keep at least one row: el_table')
    expect(() => new EditorEngine(makeStructureDocument()).dispatch({ type: 'deleteTableColumn', elementId: 'el_table', index: 0, count: 4 })).toThrow('table must keep at least one column: el_table')
  })

  it('migrates table selection and keeps structure operations atomic in history', () => {
    const engine = new EditorEngine(makeStructureDocument())
    engine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 3, column: 3 })
    const original = engine.getState().document

    const inserted = engine.dispatch({ type: 'insertTableRow', elementId: 'el_table', index: 1 })
    expect(inserted.tableCellSelection).toEqual({ elementId: 'el_table', anchorRow: 4, anchorColumn: 3, row: 4, column: 3 })
    expect(inserted.history).toEqual({ undoDepth: 1, redoDepth: 0 })

    const deleted = engine.dispatch({ type: 'deleteTableColumn', elementId: 'el_table', index: 2, count: 2 })
    expect(deleted.tableCellSelection).toEqual({ elementId: 'el_table', anchorRow: 4, anchorColumn: 1, row: 4, column: 1 })
    expect(deleted.history).toEqual({ undoDepth: 2, redoDepth: 0 })
    expect(engine.dispatch({ type: 'undo' }).tableCellSelection).toEqual(deleted.tableCellSelection)
    expect(engine.dispatch({ type: 'undo' }).document).toEqual(original)
    expect(engine.dispatch({ type: 'redo' }).history).toEqual({ undoDepth: 1, redoDepth: 1 })
  })

  it('rejects invalid table structure commands without side effects', () => {
    const engine = new EditorEngine(makeStructureDocument())
    const before = engine.getState()

    expect(() => engine.dispatch({ type: 'insertTableRow', elementId: 'el_a', index: 0 })).toThrow('element is not a table: el_a')
    expect(() => engine.dispatch({ type: 'insertTableRow', elementId: 'el_table', index: -1 })).toThrow('table row insertion index is outside table: el_table[-1]')
    expect(() => engine.dispatch({ type: 'insertTableColumn', elementId: 'el_table', index: 1, count: 0 })).toThrow('table structure count must be a positive integer: el_table[0]')
    expect(() => engine.dispatch({ type: 'deleteTableColumn', elementId: 'el_table', index: 3, count: 2 })).toThrow('table column deletion range is outside table: el_table[3,5)')
    expect(engine.getState()).toEqual(before)
  })

  it('moves selected bounds and snaps to another element edge', () => {
    const engine = new EditorEngine(makeDocument(), { snap: { threshold: 100000 } })
    engine.dispatch({ type: 'select', elementIds: ['el_a'] })
    const state = engine.dispatch({ type: 'move', dx: 1900000, dy: 0 })

    expect(state.document.elements.el_a?.bounds.x).toBe(3000000)
    expect(state.guides).toEqual([
      { axis: 'x', position: 4000000, source: 'element', elementId: 'el_b' },
      { axis: 'y', position: 1000000, source: 'element', elementId: 'el_b' },
    ])
    expect(state.history).toEqual({ undoDepth: 1, redoDepth: 0 })
    expect(engine.dispatch({ type: 'undo' }).document.elements.el_a?.bounds.x).toBe(1000000)
    expect(engine.dispatch({ type: 'redo' }).document.elements.el_a?.bounds.x).toBe(3000000)
  })

  it('resizes one element and rejects non-positive bounds', () => {
    const engine = new EditorEngine(makeDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_a'] })
    expect(engine.dispatch({ type: 'resize', elementId: 'el_a', bounds: { x: 2, y: 3, w: 4, h: 5 } }).document.elements.el_a?.bounds).toEqual({ x: 2, y: 3, w: 4, h: 5 })
    expect(() => engine.dispatch({ type: 'resize', elementId: 'el_a', bounds: { x: 2, y: 3, w: 0, h: 5 } })).toThrow('bounds must be positive')
    expect(engine.getState().history.undoDepth).toBe(1)
  })

  it('changes z-order while preserving selected relative order', () => {
    const engine = new EditorEngine(makeDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_a'] })
    expect(engine.dispatch({ type: 'zOrder', action: 'front' }).document.slides.sld_1?.elementIds).toEqual(['el_b', 'el_a'])
    expect(engine.dispatch({ type: 'zOrder', action: 'back' }).document.slides.sld_1?.elementIds).toEqual(['el_a', 'el_b'])
  })

  it('undoes and redoes z-order changes without changing selection', () => {
    const engine = new EditorEngine(makeDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_a'] })
    engine.dispatch({ type: 'zOrder', action: 'front' })

    expect(engine.dispatch({ type: 'undo' }).document.slides.sld_1?.elementIds).toEqual(['el_a', 'el_b'])
    expect(engine.getState().selection).toEqual(['el_a'])
    expect(engine.dispatch({ type: 'redo' }).document.slides.sld_1?.elementIds).toEqual(['el_b', 'el_a'])
  })

  it('groups selected elements and restores order on undo and ungroup', () => {
    const engine = new EditorEngine(makeDocument(), { idFactory: () => 'grp_1' })
    engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })
    engine.dispatch({ type: 'group' })
    expect(engine.getState().document.slides.sld_1?.elementIds).toEqual(['grp_1'])
    expect(engine.getState().document.elements.grp_1).toMatchObject({ kind: 'group', childIds: ['el_a', 'el_b'] })
    engine.dispatch({ type: 'ungroup', groupId: 'grp_1' })
    expect(engine.getState().document.slides.sld_1?.elementIds).toEqual(['el_a', 'el_b'])
    expect(engine.getState().document.elements.grp_1).toBeUndefined()
  })

  it('generates deterministic group ids per engine session', () => {
    const engine = new EditorEngine(makeDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })
    engine.dispatch({ type: 'group' })

    expect(engine.getState().document.elements.grp_1).toMatchObject({ kind: 'group' })
  })

  it('removes deleted elements from selection during history replay', () => {
    const engine = new EditorEngine(makeDocument(), { idFactory: () => 'grp_1' })
    engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })
    engine.dispatch({ type: 'group' })
    expect(engine.getState().selection).toEqual(['grp_1'])

    expect(engine.dispatch({ type: 'undo' }).selection).toEqual([])
  })

  it('undoes grouping and redoes ungrouping', () => {
    const engine = new EditorEngine(makeDocument(), { idFactory: () => 'grp_1' })
    engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })
    engine.dispatch({ type: 'group' })

    expect(engine.dispatch({ type: 'undo' }).document.slides.sld_1?.elementIds).toEqual(['el_a', 'el_b'])
    expect(engine.getState().document.elements.grp_1).toBeUndefined()
    engine.dispatch({ type: 'redo' })
    engine.dispatch({ type: 'ungroup', groupId: 'grp_1' })
    expect(engine.dispatch({ type: 'undo' }).document.elements.grp_1).toMatchObject({ kind: 'group' })
    expect(engine.dispatch({ type: 'redo' }).document.elements.grp_1).toBeUndefined()
  })

  it('does not add no-op commands to history', () => {
    const engine = new EditorEngine(makeDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_a'] })

    expect(engine.dispatch({ type: 'move', dx: 0, dy: 0 }).history).toEqual({ undoDepth: 0, redoDepth: 0 })
    expect(engine.dispatch({ type: 'zOrder', action: 'front' }).history).toEqual({ undoDepth: 1, redoDepth: 0 })
    expect(engine.dispatch({ type: 'zOrder', action: 'front' }).history).toEqual({ undoDepth: 1, redoDepth: 0 })
  })
})

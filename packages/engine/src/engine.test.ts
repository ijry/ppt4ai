import { describe, expect, it } from 'vitest'
import { EditorEngine } from './index'
import type { AssetMetadata, ImageElement, Ppt4aiDocument } from '@ppt4ai/model'

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

function imageAsset(id: string, mimeType: AssetMetadata['mimeType'] = 'image/png'): AssetMetadata {
  return { id, mimeType, pixelWidth: 12, pixelHeight: 34 }
}

function imageElement(id: string, assetId: string): ImageElement {
  return {
    id,
    kind: 'image',
    bounds: { x: 1000000, y: 2000000, w: 2000000, h: 1500000 },
    assetId,
    transform: { rotation: 900000, flipH: true },
    sourceCrop: { left: 1000, bottom: 2000 },
    maskPreset: 'roundRect',
    effects: [{ type: 'grayscl' }],
  }
}

function makeImageDocument(sharedAsset = false): Ppt4aiDocument {
  const document = makeDocument()
  const first = imageElement('img_1', 'asset_old')
  document.elements[first.id] = first
  document.slides.sld_1!.elementIds.push(first.id)
  document.assets = { asset_old: imageAsset('asset_old') }
  if (sharedAsset) {
    const second = imageElement('img_2', 'asset_old')
    second.bounds.x = 5000000
    document.elements[second.id] = second
    document.slides.sld_1!.elementIds.push(second.id)
  }
  return document
}

function makeAssetReferenceDocument(sharedAsset = false): Ppt4aiDocument {
  const document = makeImageDocument(sharedAsset)
  document.assets!.asset_spare = imageAsset('asset_spare', 'image/jpeg')
  return document
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

function makeMergeSplitDocument(): Ppt4aiDocument {
  const document = makeDocument()
  document.slides.sld_1!.elementIds.push('el_table')
  document.elements.el_table = {
    id: 'el_table',
    kind: 'table',
    bounds: { x: 1000, y: 2000, w: 600, h: 300 },
    columns: [100, 200, 300],
    rows: [
      { height: 50, cells: [0, 1, 2].map((column) => ({ column, body: { paragraphs: [{ runs: [{ text: `R0C${column}` }] }] } })) },
      { height: 100, cells: [0, 1, 2].map((column) => ({ column, body: { paragraphs: [{ runs: [{ text: `R1C${column}` }] }] } })) },
      { height: 150, cells: [0, 1, 2].map((column) => ({ column, body: { paragraphs: [{ runs: [{ text: `R2C${column}` }] }] } })) },
    ],
  }
  return document
}

function makeMergedCellDocument(rowSpan = 2, colSpan = 2): Ppt4aiDocument {
  const document = makeMergeSplitDocument()
  const table = document.elements.el_table
  if (!table || table.kind !== 'table') throw new Error('expected table')
  table.rows[0]!.cells[0] = {
    column: 0,
    ...(rowSpan > 1 ? { rowSpan } : {}),
    ...(colSpan > 1 ? { colSpan } : {}),
    body: { paragraphs: [{ runs: [{ text: 'Merged' }] }] },
    fill: { color: { type: 'srgb', v: 'ABCDEF' } },
    borders: { left: { color: { type: 'srgb', v: '123456' }, width: 100, style: 'solid' } },
  }
  table.rows[0]!.cells = table.rows[0]!.cells.filter((cell) => cell.column === 0 || cell.column >= colSpan)
  for (let row = 1; row < rowSpan; row += 1) table.rows[row]!.cells = table.rows[row]!.cells.filter((cell) => cell.column >= colSpan)
  return document
}

describe('EditorEngine', () => {
  it('inserts an image, registers its asset, and selects it atomically', () => {
    const engine = new EditorEngine(makeDocument())
    const element = imageElement('img_new', 'asset_new')
    const asset = imageAsset('asset_new')
    const state = engine.dispatch({ type: 'insertImage', slideId: 'sld_1', element, asset })

    expect(state.document.slides.sld_1?.elementIds).toEqual(['el_a', 'el_b', 'img_new'])
    expect(state.document.elements.img_new).toEqual(element)
    expect(state.document.assets).toEqual({ asset_new: asset })
    expect(state.selection).toEqual(['img_new'])
    expect(state.history).toEqual({ undoDepth: 1, redoDepth: 0 })

    element.bounds.x = 99
    asset.pixelWidth = 99
    expect(engine.getState().document.elements.img_new).toEqual({ ...imageElement('img_new', 'asset_new') })
    expect(engine.getState().document.assets).toEqual({ asset_new: imageAsset('asset_new') })
  })

  it('rejects invalid image insertion without changing engine state', () => {
    const engine = new EditorEngine(makeDocument())
    const before = engine.getState()

    expect(() => engine.dispatch({
      type: 'insertImage',
      slideId: 'missing',
      element: imageElement('img_new', 'asset_new'),
      asset: imageAsset('asset_new'),
    })).toThrow('slide does not exist: missing')
    expect(engine.getState()).toEqual(before)
  })

  it.each([
    ['element already exists: el_a', { slideId: 'sld_1', element: imageElement('el_a', 'asset_new'), asset: imageAsset('asset_new') }],
    ['asset already exists: asset_old', { slideId: 'sld_1', element: imageElement('img_new', 'asset_old'), asset: imageAsset('asset_old') }],
    ['image element asset does not match metadata: img_new', { slideId: 'sld_1', element: imageElement('img_new', 'asset_a'), asset: imageAsset('asset_b') }],
  ] as const)('rejects invalid insertion case %s atomically', (message, command) => {
    const engine = new EditorEngine(makeImageDocument())
    const before = engine.getState()
    expect(() => engine.dispatch({ type: 'insertImage', ...command })).toThrow(message)
    expect(engine.getState()).toEqual(before)
  })

  it('replaces an image asset while preserving appearance and cleans zero references', () => {
    const engine = new EditorEngine(makeImageDocument())
    const before = engine.getState().document.elements.img_1 as ImageElement
    const state = engine.dispatch({
      type: 'replaceImageAsset',
      elementId: 'img_1',
      asset: imageAsset('asset_new', 'image/jpeg'),
    })

    expect(state.document.elements.img_1).toEqual({ ...before, assetId: 'asset_new' })
    expect(state.document.assets).toEqual({ asset_new: imageAsset('asset_new', 'image/jpeg') })
    expect(state.history).toEqual({ undoDepth: 1, redoDepth: 0 })
    expect(engine.dispatch({ type: 'undo' }).document).toEqual(makeImageDocument())
    expect(engine.dispatch({ type: 'redo' }).document).toEqual(state.document)
  })

  it('keeps shared old asset metadata until its final reference is replaced', () => {
    const engine = new EditorEngine(makeImageDocument(true))
    engine.dispatch({ type: 'replaceImageAsset', elementId: 'img_1', asset: imageAsset('asset_new') })
    expect(engine.getState().document.assets).toEqual({ asset_old: imageAsset('asset_old'), asset_new: imageAsset('asset_new') })
    const state = engine.dispatch({ type: 'replaceImageAsset', elementId: 'img_2', asset: imageAsset('asset_final') })
    expect(state.document.assets).toEqual({ asset_new: imageAsset('asset_new'), asset_final: imageAsset('asset_final') })
  })

  it('inserts an image that reuses existing asset metadata atomically', () => {
    const document = makeAssetReferenceDocument()
    const engine = new EditorEngine(document)
    const element = imageElement('img_new', 'asset_spare')
    const state = engine.dispatch({ type: 'insertImageReference', slideId: 'sld_1', element, assetId: 'asset_spare' })

    expect(state.document.slides.sld_1?.elementIds).toEqual(['el_a', 'el_b', 'img_1', 'img_new'])
    expect(state.document.elements.img_new).toEqual(element)
    expect(state.document.assets).toEqual(document.assets)
    expect(state.selection).toEqual(['img_new'])
    expect(state.history).toEqual({ undoDepth: 1, redoDepth: 0 })
    expect(engine.dispatch({ type: 'undo' }).document).toEqual(document)
    expect(engine.dispatch({ type: 'redo' }).document).toEqual(state.document)
  })

  it('replaces an image with an existing asset while preserving appearance', () => {
    const document = makeAssetReferenceDocument()
    const before = document.elements.img_1 as ImageElement
    const engine = new EditorEngine(document)
    const state = engine.dispatch({ type: 'replaceImageAssetReference', elementId: 'img_1', assetId: 'asset_spare' })

    expect(state.document.elements.img_1).toEqual({ ...before, assetId: 'asset_spare' })
    expect(state.document.assets).toEqual({ asset_spare: imageAsset('asset_spare', 'image/jpeg') })
    expect(state.history).toEqual({ undoDepth: 1, redoDepth: 0 })
    expect(engine.dispatch({ type: 'undo' }).document).toEqual(document)
    expect(engine.dispatch({ type: 'redo' }).document).toEqual(state.document)
  })

  it('keeps old metadata while another image still references it', () => {
    const engine = new EditorEngine(makeAssetReferenceDocument(true))
    const state = engine.dispatch({ type: 'replaceImageAssetReference', elementId: 'img_1', assetId: 'asset_spare' })

    expect(state.document.assets).toEqual({
      asset_old: imageAsset('asset_old'),
      asset_spare: imageAsset('asset_spare', 'image/jpeg'),
    })
    expect((state.document.elements.img_2 as ImageElement).assetId).toBe('asset_old')
  })

  it.each([
    ['slide does not exist: missing', { type: 'insertImageReference', slideId: 'missing', element: imageElement('img_new', 'asset_spare'), assetId: 'asset_spare' }],
    ['element already exists: img_1', { type: 'insertImageReference', slideId: 'sld_1', element: imageElement('img_1', 'asset_spare'), assetId: 'asset_spare' }],
    ['asset does not exist: asset_missing', { type: 'insertImageReference', slideId: 'sld_1', element: imageElement('img_new', 'asset_missing'), assetId: 'asset_missing' }],
    ['image element asset does not match reference: img_new', { type: 'insertImageReference', slideId: 'sld_1', element: imageElement('img_new', 'asset_spare'), assetId: 'asset_old' }],
    ['element does not exist: missing', { type: 'replaceImageAssetReference', elementId: 'missing', assetId: 'asset_spare' }],
    ['element is not an image: el_a', { type: 'replaceImageAssetReference', elementId: 'el_a', assetId: 'asset_spare' }],
    ['replacement asset must differ: asset_old', { type: 'replaceImageAssetReference', elementId: 'img_1', assetId: 'asset_old' }],
    ['asset does not exist: asset_missing', { type: 'replaceImageAssetReference', elementId: 'img_1', assetId: 'asset_missing' }],
  ] as const)('rejects invalid existing-asset operation %s atomically', (message, command) => {
    const engine = new EditorEngine(makeAssetReferenceDocument())
    const before = engine.getState()

    expect(() => engine.dispatch(command)).toThrow(message)
    expect(engine.getState()).toEqual(before)
  })

  it.each([
    ['element does not exist: missing', 'missing', 'asset_new'],
    ['element is not an image: el_a', 'el_a', 'asset_new'],
  ] as const)('rejects invalid replacement case %s atomically', (message, elementId, assetId) => {
    const engine = new EditorEngine(makeImageDocument())
    const before = engine.getState()
    expect(() => engine.dispatch({ type: 'replaceImageAsset', elementId, asset: imageAsset(assetId) })).toThrow(message)
    expect(engine.getState()).toEqual(before)
  })

  it('rejects replacement metadata that already exists without changing state', () => {
    const engine = new EditorEngine(makeImageDocument(true))
    const before = engine.getState()
    expect(() => engine.dispatch({ type: 'replaceImageAsset', elementId: 'img_1', asset: imageAsset('asset_old') })).toThrow('replacement asset must differ: asset_old')
    expect(engine.getState()).toEqual(before)
  })

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

  it('merges a rectangular selection while preserving content and top-left style', () => {
    const document = makeMergeSplitDocument()
    const table = document.elements.el_table
    if (!table || table.kind !== 'table') throw new Error('expected table')
    const topLeft = table.rows[0]!.cells[0]!
    topLeft.body = {
      bodyPr: { verticalAlign: 'middle' },
      paragraphs: [
        { runs: [], attrs: { spaceAfter: 10 } },
        { runs: [{ text: 'A', marks: { bold: true } }] },
      ],
    }
    topLeft.fill = { color: { type: 'srgb', v: 'ABCDEF' } }
    topLeft.borders = { left: { color: { type: 'srgb', v: '123456' }, width: 100, style: 'solid' } }
    table.rows[0]!.cells[1]!.body = { paragraphs: [{ runs: [] }, { runs: [{ text: 'B', marks: { italic: true } }], attrs: { align: 'center' } }] }
    table.rows[1]!.cells[0]!.body = { paragraphs: [{ runs: [{ text: 'C' }] }] }
    table.rows[1]!.cells[1]!.body = { paragraphs: [{ runs: [{ text: 'D' }] }] }
    const engine = new EditorEngine(document)

    engine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 1, column: 1 })
    engine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 0, column: 0, extend: true })
    const merged = engine.dispatch({ type: 'mergeTableCells' })
    const result = merged.document.elements.el_table

    expect(result?.kind).toBe('table')
    if (!result || result.kind !== 'table') throw new Error('expected table')
    expect(result.columns).toEqual([100, 200, 300])
    expect(result.rows.map((row) => row.height)).toEqual([50, 100, 150])
    expect(result.rows[0]!.cells[0]).toEqual({
      column: 0,
      rowSpan: 2,
      colSpan: 2,
      body: {
        bodyPr: { verticalAlign: 'middle' },
        paragraphs: [
          { runs: [], attrs: { spaceAfter: 10 } },
          { runs: [{ text: 'A', marks: { bold: true } }] },
          { runs: [{ text: 'B', marks: { italic: true } }], attrs: { align: 'center' } },
          { runs: [{ text: 'C' }] },
          { runs: [{ text: 'D' }] },
        ],
      },
      fill: { color: { type: 'srgb', v: 'ABCDEF' } },
      borders: { left: { color: { type: 'srgb', v: '123456' }, width: 100, style: 'solid' } },
    })
    expect(result.rows.map((row) => row.cells.map((cell) => cell.column))).toEqual([[0, 2], [2], [0, 1, 2]])
    expect(merged.tableCellSelection).toEqual({ elementId: 'el_table', anchorRow: 0, anchorColumn: 0, row: 0, column: 0 })
    expect(merged.history).toEqual({ undoDepth: 1, redoDepth: 0 })
  })

  it('expands endpoint merged cells but rejects partial middle overlap', () => {
    const endpointDocument = makeMergeSplitDocument()
    const endpointTable = endpointDocument.elements.el_table
    if (!endpointTable || endpointTable.kind !== 'table') throw new Error('expected table')
    endpointTable.rows[0]!.cells[1]!.rowSpan = 2
    endpointTable.rows[1]!.cells = [endpointTable.rows[1]!.cells[0]!, endpointTable.rows[1]!.cells[2]!]
    const endpointEngine = new EditorEngine(endpointDocument)
    endpointEngine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 1, column: 1 })
    endpointEngine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 0, column: 0, extend: true })
    const endpointResult = endpointEngine.dispatch({ type: 'mergeTableCells' }).document.elements.el_table
    expect(endpointResult?.kind).toBe('table')
    if (!endpointResult || endpointResult.kind !== 'table') throw new Error('expected table')
    expect(endpointResult.rows[0]!.cells[0]).toMatchObject({ column: 0, rowSpan: 2, colSpan: 2 })

    const partialDocument = makeMergeSplitDocument()
    const partialTable = partialDocument.elements.el_table
    if (!partialTable || partialTable.kind !== 'table') throw new Error('expected table')
    partialTable.rows[0]!.cells[1]!.rowSpan = 2
    partialTable.rows[1]!.cells = [partialTable.rows[1]!.cells[0]!, partialTable.rows[1]!.cells[2]!]
    const partialEngine = new EditorEngine(partialDocument)
    partialEngine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 0, column: 0 })
    partialEngine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 0, column: 2, extend: true })
    const before = partialEngine.getState()
    expect(() => partialEngine.dispatch({ type: 'mergeTableCells' })).toThrow('table merge selection partially covers merged cell: el_table')
    expect(partialEngine.getState()).toEqual(before)
  })

  it.each([
    ['row', 2, 1],
    ['column', 1, 2],
    ['rectangle', 2, 2],
  ] as const)('splits a %s merged cell without duplicating content or style', (_name, rowSpan, colSpan) => {
    const document = makeMergedCellDocument(rowSpan, colSpan)
    const engine = new EditorEngine(document)
    engine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 0, column: 0 })
    const split = engine.dispatch({ type: 'splitTableCell' })
    const splitTable = split.document.elements.el_table
    expect(splitTable?.kind).toBe('table')
    if (!splitTable || splitTable.kind !== 'table') throw new Error('expected table')
    expect(splitTable.rows[0]!.cells[0]).toEqual({
      column: 0,
      body: { paragraphs: [{ runs: [{ text: 'Merged' }] }] },
      fill: { color: { type: 'srgb', v: 'ABCDEF' } },
      borders: { left: { color: { type: 'srgb', v: '123456' }, width: 100, style: 'solid' } },
    })
    for (let row = 0; row < rowSpan; row += 1) {
      for (let column = 0; column < colSpan; column += 1) {
        if (row === 0 && column === 0) continue
        expect(splitTable.rows[row]!.cells.find((cell) => cell.column === column)).toEqual({ column, body: { paragraphs: [{ runs: [] }] } })
      }
    }
    expect(split.history).toEqual({ undoDepth: 1, redoDepth: 0 })
    expect(split.tableCellSelection).toEqual({ elementId: 'el_table', anchorRow: 0, anchorColumn: 0, row: 0, column: 0 })
    expect(engine.dispatch({ type: 'undo' }).document.elements.el_table).toEqual(document.elements.el_table)
    expect(engine.dispatch({ type: 'redo' }).history).toEqual({ undoDepth: 1, redoDepth: 0 })
  })

  it('keeps merge and split no-ops and invalid candidates side-effect free', () => {
    const noSelection = new EditorEngine(makeMergeSplitDocument())
    const beforeNoSelection = noSelection.getState()
    expect(noSelection.dispatch({ type: 'mergeTableCells' })).toEqual(beforeNoSelection)

    const unmerged = new EditorEngine(makeMergeSplitDocument())
    unmerged.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 0, column: 0 })
    const beforeUnmerged = unmerged.getState()
    expect(unmerged.dispatch({ type: 'mergeTableCells' })).toEqual(beforeUnmerged)
    expect(unmerged.dispatch({ type: 'splitTableCell' })).toEqual(beforeUnmerged)

    const invalidDocument = makeMergeSplitDocument()
    const invalidTable = invalidDocument.elements.el_table
    if (!invalidTable || invalidTable.kind !== 'table') throw new Error('expected table')
    invalidTable.rows[2]!.cells[2]!.body = { paragraphs: [] }
    const invalidEngine = new EditorEngine(invalidDocument)
    invalidEngine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 0, column: 0 })
    invalidEngine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 0, column: 1, extend: true })
    const beforeInvalid = invalidEngine.getState()
    expect(() => invalidEngine.dispatch({ type: 'mergeTableCells' })).toThrow('table merge is invalid: el_table:')
    expect(invalidEngine.getState()).toEqual(beforeInvalid)
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

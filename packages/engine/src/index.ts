import { validateDocument, validateTextBody, type AssetMetadata, type Element, type ElementTransform, type Fill, type ImageElement, type Ppt4aiDocument, type Rect, type TableBorder, type TableCell, type TableCellBorders, type TableElement, type TableRow, type TextBody } from '@ppt4ai/model'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type PatchValue =
  | { present: false }
  | { present: true; value: JsonValue }

export interface PatchOperation {
  path: string[]
  before: PatchValue
  after: PatchValue
}

export interface Patch {
  operations: PatchOperation[]
}

export interface SnapOptions {
  gridSize?: number
  threshold: number
  enabled?: boolean
}

export interface EngineOptions {
  snap?: SnapOptions
  idFactory?: (prefix: string) => string
}

export interface SnapGuide {
  axis: 'x' | 'y'
  position: number
  source: 'grid' | 'element'
  elementId?: string
}

export interface EngineState {
  document: Ppt4aiDocument
  selection: string[]
  tableCellSelection?: TableCellSelection
  guides: SnapGuide[]
  history: {
    undoDepth: number
    redoDepth: number
  }
}

export interface TableCellSelection {
  elementId: string
  anchorRow: number
  anchorColumn: number
  row: number
  column: number
}

export type ImageFlipAxis = 'horizontal' | 'vertical'

export type EngineCommand =
  | { type: 'select'; elementIds: string[]; additive?: boolean }
  | { type: 'insertImage'; slideId: string; element: ImageElement; asset: AssetMetadata }
  | { type: 'insertImageReference'; slideId: string; element: ImageElement; assetId: string }
  | { type: 'replaceImageAsset'; elementId: string; asset: AssetMetadata }
  | { type: 'replaceImageAssetReference'; elementId: string; assetId: string }
  | { type: 'setImageRotation'; elementId: string; rotation: number }
  | { type: 'toggleImageFlip'; elementId: string; axis: ImageFlipAxis }
  | { type: 'selectTableCell'; elementId: string; row: number; column: number; extend?: boolean }
  | { type: 'setTableCellText'; body: TextBody }
  | { type: 'setTextBody'; elementId: string; body: TextBody }
  | { type: 'setTableCellFill'; fill: Fill | null }
  | { type: 'setTableCellBorders'; borders: Partial<Record<TableBorderSide, TableBorder | null>> }
  | { type: 'mergeTableCells' }
  | { type: 'splitTableCell' }
  | { type: 'insertTableRow'; elementId: string; index: number; count?: number }
  | { type: 'deleteTableRow'; elementId: string; index: number; count?: number }
  | { type: 'insertTableColumn'; elementId: string; index: number; count?: number }
  | { type: 'deleteTableColumn'; elementId: string; index: number; count?: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'move'; dx: number; dy: number }
  | { type: 'resize'; elementId: string; bounds: Rect }
  | { type: 'resizeSelection'; bounds: Rect }
  | { type: 'zOrder'; action: 'front' | 'back' | 'forward' | 'backward' }
  | { type: 'group' }
  | { type: 'ungroup'; groupId: string }

interface HistoryEntry {
  patch: Patch
  inverse: Patch
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getAt(root: unknown, path: string[]): unknown {
  let current = root
  for (const key of path) {
    if (!isRecord(current) && !Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function toPatchValue(value: unknown): PatchValue {
  return value === undefined ? { present: false } : { present: true, value: clone(value as JsonValue) }
}

function setAt(root: unknown, path: string[], patchValue: PatchValue): void {
  if (path.length === 0) throw new Error('patch path cannot be empty')
  let current = root as Record<string, unknown> | unknown[]
  for (const key of path.slice(0, -1)) {
    const next = (current as Record<string, unknown>)[key]
    if (!isRecord(next) && !Array.isArray(next)) throw new Error(`patch path does not exist: ${path.join('.')}`)
    current = next as Record<string, unknown> | unknown[]
  }
  const key = path[path.length - 1]!
  if (patchValue.present) (current as Record<string, unknown>)[key] = clone(patchValue.value)
  else if (Array.isArray(current)) current.splice(Number(key), 1)
  else delete (current as Record<string, unknown>)[key]
}

function applyPatch(document: Ppt4aiDocument, patch: Patch): Ppt4aiDocument {
  const next = clone(document)
  for (const operation of patch.operations) setAt(next, operation.path, operation.after)
  return next
}

function inversePatch(patch: Patch): Patch {
  return {
    operations: [...patch.operations].reverse().map((operation) => ({
      path: [...operation.path],
      before: clone(operation.after),
      after: clone(operation.before),
    })),
  }
}

function makePatch(document: Ppt4aiDocument, changes: Array<{ path: string[]; value: unknown }>): Patch {
  return {
    operations: changes.flatMap(({ path, value }) => {
      const before = toPatchValue(getAt(document, path))
      const after = toPatchValue(value)
      return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ path, before, after }]
    }),
  }
}

function validSelection(document: Ppt4aiDocument, elementIds: string[]): string[] {
  return [...new Set(elementIds)].filter((elementId) => Boolean(document.elements[elementId]))
}

interface TableSourceCell {
  row: number
  column: number
  cellIndex: number
}

type TableStructureOperation =
  | { axis: 'row'; mode: 'insert' | 'delete'; index: number; count: number }
  | { axis: 'column'; mode: 'insert' | 'delete'; index: number; count: number }

interface TableSourceRect {
  row: number
  column: number
  rowSpan: number
  colSpan: number
  cell: TableCell
}

interface TableGridRect {
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
}

type TableMergeResult =
  | { status: 'noop' }
  | { status: 'partial-overlap' }
  | { status: 'merged'; table: TableElement; row: number; column: number }

interface TableStructureResult {
  table: TableElement
  mapPoint(point: { row: number; column: number }): { row: number; column: number } | undefined
}

type TableBorderSide = 'left' | 'right' | 'top' | 'bottom'

const tableBorderSides: TableBorderSide[] = ['left', 'right', 'top', 'bottom']

function sourceCellAt(table: TableElement, row: number, column: number): TableSourceCell | undefined {
  for (let sourceRow = 0; sourceRow < table.rows.length; sourceRow += 1) {
    const cells = table.rows[sourceRow]?.cells ?? []
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
      const cell = cells[cellIndex]!
      if (sourceRow <= row && row < sourceRow + (cell.rowSpan ?? 1) && cell.column <= column && column < cell.column + (cell.colSpan ?? 1)) {
        return { row: sourceRow, column: cell.column, cellIndex }
      }
    }
  }
  return undefined
}

function sourceCellsInSelection(table: TableElement, selection: TableCellSelection): TableSourceCell[] {
  const minRow = Math.min(selection.anchorRow, selection.row)
  const maxRow = Math.max(selection.anchorRow, selection.row)
  const minColumn = Math.min(selection.anchorColumn, selection.column)
  const maxColumn = Math.max(selection.anchorColumn, selection.column)
  const sources: TableSourceCell[] = []
  for (let row = 0; row < table.rows.length; row += 1) {
    const cells = table.rows[row]?.cells ?? []
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
      const cell = cells[cellIndex]!
      const cellMaxRow = row + (cell.rowSpan ?? 1) - 1
      const cellMaxColumn = cell.column + (cell.colSpan ?? 1) - 1
      if (row <= maxRow && cellMaxRow >= minRow && cell.column <= maxColumn && cellMaxColumn >= minColumn) {
        sources.push({ row, column: cell.column, cellIndex })
      }
    }
  }
  return sources
}

function validTableCellSelection(document: Ppt4aiDocument, selection: TableCellSelection | undefined): TableCellSelection | undefined {
  if (!selection) return undefined
  const element = document.elements[selection.elementId]
  if (!element || element.kind !== 'table') return undefined
  if (!sourceCellAt(element, selection.anchorRow, selection.anchorColumn) || !sourceCellAt(element, selection.row, selection.column)) return undefined
  return selection
}

function emptyTableCell(column: number): TableCell {
  return { column, body: { paragraphs: [{ runs: [] }] } }
}

function tableSourceRects(table: TableElement): TableSourceRect[] {
  return table.rows.flatMap((row, rowIndex) => row.cells.map((cell) => ({
    row: rowIndex,
    column: cell.column,
    rowSpan: cell.rowSpan ?? 1,
    colSpan: cell.colSpan ?? 1,
    cell: clone(cell),
  })))
}

function sourceRect(table: TableElement, source: TableSourceCell): TableSourceRect {
  const cell = table.rows[source.row]!.cells[source.cellIndex]!
  return {
    row: source.row,
    column: cell.column,
    rowSpan: cell.rowSpan ?? 1,
    colSpan: cell.colSpan ?? 1,
    cell: clone(cell),
  }
}

function intersectsTableRect(source: TableSourceRect, target: TableGridRect): boolean {
  return source.row <= target.maxRow && source.row + source.rowSpan - 1 >= target.minRow
    && source.column <= target.maxColumn && source.column + source.colSpan - 1 >= target.minColumn
}

function containsTableRect(target: TableGridRect, source: TableSourceRect): boolean {
  return source.row >= target.minRow && source.row + source.rowSpan - 1 <= target.maxRow
    && source.column >= target.minColumn && source.column + source.colSpan - 1 <= target.maxColumn
}

function mergeSelectionRect(table: TableElement, selection: TableCellSelection): TableGridRect | undefined {
  const anchor = sourceCellAt(table, selection.anchorRow, selection.anchorColumn)
  const focus = sourceCellAt(table, selection.row, selection.column)
  if (!anchor || !focus) return undefined
  const anchorRect = sourceRect(table, anchor)
  const focusRect = sourceRect(table, focus)
  return {
    minRow: Math.min(anchorRect.row, focusRect.row),
    maxRow: Math.max(anchorRect.row + anchorRect.rowSpan - 1, focusRect.row + focusRect.rowSpan - 1),
    minColumn: Math.min(anchorRect.column, focusRect.column),
    maxColumn: Math.max(anchorRect.column + anchorRect.colSpan - 1, focusRect.column + focusRect.colSpan - 1),
  }
}

function hasNonEmptyText(paragraph: TextBody['paragraphs'][number]): boolean {
  return paragraph.runs.some((run) => run.text.length > 0)
}

function mergeTableCellBodies(sources: TableSourceRect[], topLeft: TableSourceRect): TextBody {
  const ordered = [...sources].sort((left, right) => left.row - right.row || left.column - right.column)
  const paragraphs = clone(topLeft.cell.body.paragraphs)
  for (const source of ordered) {
    if (source === topLeft) continue
    paragraphs.push(...clone(source.cell.body.paragraphs).filter(hasNonEmptyText))
  }
  return {
    ...(topLeft.cell.body.bodyPr ? { bodyPr: clone(topLeft.cell.body.bodyPr) } : {}),
    paragraphs: paragraphs.length > 0 ? paragraphs : [{ runs: [] }],
  }
}

function mergeTableSelection(table: TableElement, selection: TableCellSelection): TableMergeResult {
  const target = mergeSelectionRect(table, selection)
  if (!target) return { status: 'noop' }
  const sources = tableSourceRects(table).filter((source) => intersectsTableRect(source, target))
  if (sources.length <= 1) return { status: 'noop' }
  if (sources.some((source) => !containsTableRect(target, source))) return { status: 'partial-overlap' }
  const topLeft = sources.find((source) => source.row === target.minRow && source.column === target.minColumn)
  if (!topLeft) return { status: 'partial-overlap' }
  const mergedCell: TableCell = {
    column: target.minColumn,
    body: mergeTableCellBodies(sources, topLeft),
    ...(target.maxRow > target.minRow ? { rowSpan: target.maxRow - target.minRow + 1 } : {}),
    ...(target.maxColumn > target.minColumn ? { colSpan: target.maxColumn - target.minColumn + 1 } : {}),
    ...(topLeft.cell.fill ? { fill: clone(topLeft.cell.fill) } : {}),
    ...(topLeft.cell.borders ? { borders: clone(topLeft.cell.borders) } : {}),
  }
  const rects = tableSourceRects(table)
    .filter((source) => !containsTableRect(target, source))
    .concat({ row: target.minRow, column: target.minColumn, rowSpan: target.maxRow - target.minRow + 1, colSpan: target.maxColumn - target.minColumn + 1, cell: mergedCell })
  return {
    status: 'merged',
    table: { ...clone(table), rows: rebuildTableRows(table.rows.length, table.columns.length, table.rows.map((row) => row.height), rects) },
    row: target.minRow,
    column: target.minColumn,
  }
}

function splitTableSource(table: TableElement, source: TableSourceCell): TableElement | undefined {
  const rect = sourceRect(table, source)
  if (rect.rowSpan === 1 && rect.colSpan === 1) return undefined
  const rects = tableSourceRects(table).filter((candidate) => !(candidate.row === rect.row && candidate.column === rect.column))
  for (let row = rect.row; row < rect.row + rect.rowSpan; row += 1) {
    for (let column = rect.column; column < rect.column + rect.colSpan; column += 1) {
      const isTopLeft = row === rect.row && column === rect.column
      const cell = isTopLeft ? clone(rect.cell) : emptyTableCell(column)
      cell.column = column
      if (isTopLeft) {
        delete cell.rowSpan
        delete cell.colSpan
      }
      rects.push({
        row,
        column,
        rowSpan: 1,
        colSpan: 1,
        cell,
      })
    }
  }
  return { ...clone(table), rows: rebuildTableRows(table.rows.length, table.columns.length, table.rows.map((row) => row.height), rects) }
}

function mapStructureCoordinate(value: number, operation: TableStructureOperation, clampDeleted: boolean): number | undefined {
  if (operation.mode === 'insert') return value >= operation.index ? value + operation.count : value
  const end = operation.index + operation.count
  if (value < operation.index) return value
  if (value >= end) return value - operation.count
  if (!clampDeleted) return undefined
  return operation.index === 0 ? 0 : operation.index - 1
}

function transformSourceRect(rect: TableSourceRect, operation: TableStructureOperation): TableSourceRect | undefined {
  const start = operation.axis === 'row' ? rect.row : rect.column
  const span = operation.axis === 'row' ? rect.rowSpan : rect.colSpan
  const end = start + span
  let nextStart = start
  let nextSpan = span

  if (operation.mode === 'insert') {
    if (start >= operation.index) nextStart += operation.count
    else if (end > operation.index) nextSpan += operation.count
  } else {
    const deleteEnd = operation.index + operation.count
    const survivingCoordinates = Array.from({ length: span }, (_, offset) => mapStructureCoordinate(start + offset, operation, false))
      .filter((coordinate): coordinate is number => coordinate !== undefined)
    if (survivingCoordinates.length === 0) return undefined
    nextStart = Math.min(...survivingCoordinates)
    nextSpan = Math.max(...survivingCoordinates) - nextStart + 1
    if (deleteEnd <= start) nextStart = start - operation.count
  }

  const cell = clone(rect.cell)
  if (operation.axis === 'row') {
    cell.column = rect.column
    if (nextSpan === 1) delete cell.rowSpan
    else cell.rowSpan = nextSpan
  } else {
    cell.column = nextStart
    if (nextSpan === 1) delete cell.colSpan
    else cell.colSpan = nextSpan
  }
  return {
    row: operation.axis === 'row' ? nextStart : rect.row,
    column: operation.axis === 'column' ? nextStart : rect.column,
    rowSpan: operation.axis === 'row' ? nextSpan : rect.rowSpan,
    colSpan: operation.axis === 'column' ? nextSpan : rect.colSpan,
    cell,
  }
}

function rebuildTableRows(rowCount: number, columnCount: number, heights: number[], rects: TableSourceRect[]): TableRow[] {
  const occupied = new Set<string>()
  const rows = heights.map((height) => ({ height, cells: [] as TableCell[] }))
  const sorted = [...rects].sort((left, right) => left.row - right.row || left.column - right.column)
  for (const rect of sorted) {
    const cell = clone(rect.cell)
    cell.column = rect.column
    if (rect.rowSpan === 1) delete cell.rowSpan
    else cell.rowSpan = rect.rowSpan
    if (rect.colSpan === 1) delete cell.colSpan
    else cell.colSpan = rect.colSpan
    rows[rect.row]?.cells.push(cell)
    for (let row = rect.row; row < rect.row + rect.rowSpan; row += 1) {
      for (let column = rect.column; column < rect.column + rect.colSpan; column += 1) occupied.add(`${row}:${column}`)
    }
  }
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      if (occupied.has(`${row}:${column}`)) continue
      rows[row]?.cells.push(emptyTableCell(column))
    }
    rows[row]?.cells.sort((left, right) => left.column - right.column)
  }
  return rows
}

function transformTableStructure(table: TableElement, operation: TableStructureOperation): TableStructureResult {
  const nextRowCount = operation.axis === 'row'
    ? table.rows.length + (operation.mode === 'insert' ? operation.count : -operation.count)
    : table.rows.length
  const nextColumnCount = operation.axis === 'column'
    ? table.columns.length + (operation.mode === 'insert' ? operation.count : -operation.count)
    : table.columns.length
  const rowHeights = table.rows.map((row) => row.height)
  const columnWidths = [...table.columns]

  if (operation.mode === 'insert') {
    if (operation.axis === 'row') {
      const sourceHeight = table.rows[Math.min(operation.index, table.rows.length - 1)]!.height
      rowHeights.splice(operation.index, 0, ...Array.from({ length: operation.count }, () => sourceHeight))
    } else {
      const sourceWidth = table.columns[Math.min(operation.index, table.columns.length - 1)]!
      columnWidths.splice(operation.index, 0, ...Array.from({ length: operation.count }, () => sourceWidth))
    }
  } else if (operation.axis === 'row') rowHeights.splice(operation.index, operation.count)
  else columnWidths.splice(operation.index, operation.count)

  const rects = tableSourceRects(table).flatMap((rect) => {
    const transformed = transformSourceRect(rect, operation)
    return transformed ? [transformed] : []
  })
  const rows = rebuildTableRows(nextRowCount, nextColumnCount, rowHeights, rects)
  const nextTable: TableElement = {
    ...clone(table),
    bounds: { ...table.bounds },
    columns: columnWidths,
    rows,
  }
  const insertedSize = operation.axis === 'row' ? rowHeights[operation.index] ?? 0 : columnWidths[operation.index] ?? 0
  const removedSize = operation.mode === 'delete'
    ? (operation.axis === 'row' ? table.rows.slice(operation.index, operation.index + operation.count).reduce((sum, row) => sum + row.height, 0) : table.columns.slice(operation.index, operation.index + operation.count).reduce((sum, width) => sum + width, 0))
    : 0
  const delta = operation.mode === 'insert' ? insertedSize * operation.count : removedSize
  if (operation.axis === 'row') nextTable.bounds.h = table.bounds.h + (operation.mode === 'insert' ? delta : -delta)
  else nextTable.bounds.w = table.bounds.w + (operation.mode === 'insert' ? delta : -delta)
  return {
    table: nextTable,
    mapPoint: (point) => {
      const row = operation.axis === 'row' ? mapStructureCoordinate(point.row, operation, true) : point.row
      const column = operation.axis === 'column' ? mapStructureCoordinate(point.column, operation, true) : point.column
      if (row === undefined || column === undefined || row < 0 || column < 0 || row >= nextRowCount || column >= nextColumnCount) return undefined
      return { row, column }
    },
  }
}

function elementBounds(element: Element): Rect {
  return element.bounds
}

function selectionBounds(document: Ppt4aiDocument, elementIds: string[]): Rect | undefined {
  const bounds = elementIds.flatMap((elementId) => {
    const element = document.elements[elementId]
    return element ? [elementBounds(element)] : []
  })
  if (bounds.length === 0) return undefined
  const left = Math.min(...bounds.map((value) => value.x))
  const top = Math.min(...bounds.map((value) => value.y))
  const right = Math.max(...bounds.map((value) => value.x + value.w))
  const bottom = Math.max(...bounds.map((value) => value.y + value.h))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

function descendantElementIds(document: Ppt4aiDocument, rootId: string, visited = new Set<string>()): string[] {
  if (visited.has(rootId) || !document.elements[rootId]) return []
  visited.add(rootId)
  const element = document.elements[rootId]!
  if (element.kind !== 'group') return [rootId]
  return [rootId, ...element.childIds.flatMap((childId) => descendantElementIds(document, childId, visited))]
}

function selectionRoots(document: Ppt4aiDocument, elementIds: string[]): string[] {
  const selectedIds = validSelection(document, elementIds)
  return selectedIds.filter((elementId) => !selectedIds.some((candidateId) => (
    candidateId !== elementId && descendantElementIds(document, candidateId).includes(elementId)
  )))
}

interface SnapCandidate {
  delta: number
  position: number
  source: 'grid' | 'element'
  elementId?: string
}

function nearestSnap(
  document: Ppt4aiDocument,
  selectedIds: string[],
  bounds: Rect,
  axis: 'x' | 'y',
  delta: number,
  options: SnapOptions | undefined,
): SnapCandidate | undefined {
  if (!options?.enabled && options?.enabled !== undefined) return undefined
  const threshold = options?.threshold ?? 0
  if (threshold < 0) return undefined
  const start = axis === 'x' ? bounds.x : bounds.y
  const size = axis === 'x' ? bounds.w : bounds.h
  const edges = [start + delta, start + delta + size / 2, start + delta + size]
  const candidates: SnapCandidate[] = []
  const selected = new Set(selectedIds)
  for (const [elementId, element] of Object.entries(document.elements)) {
    if (selected.has(elementId)) continue
    const targetStart = axis === 'x' ? element.bounds.x : element.bounds.y
    const targetSize = axis === 'x' ? element.bounds.w : element.bounds.h
    for (const position of [targetStart, targetStart + targetSize / 2, targetStart + targetSize]) {
      for (const edge of edges) candidates.push({ delta: position - edge, position, source: 'element', elementId })
    }
  }
  const gridSize = options?.gridSize
  if (gridSize && gridSize > 0) {
    for (const edge of edges) {
      const position = Math.round(edge / gridSize) * gridSize
      candidates.push({ delta: position - edge, position, source: 'grid' })
    }
  }
  candidates.sort((left, right) => {
    const distance = Math.abs(left.delta) - Math.abs(right.delta)
    if (distance !== 0) return distance
    if (left.source !== right.source) return left.source === 'element' ? -1 : 1
    return (left.elementId ?? '').localeCompare(right.elementId ?? '')
  })
  const candidate = candidates[0]
  return candidate && Math.abs(candidate.delta) <= threshold ? candidate : undefined
}

export class EditorEngine {
  private document: Ppt4aiDocument
  private selection: string[] = []
  private tableCellSelection: TableCellSelection | undefined
  private guides: SnapGuide[] = []
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private groupSequence = 1
  private readonly options: EngineOptions

  constructor(document: Ppt4aiDocument, options: EngineOptions = {}) {
    this.document = clone(document)
    this.options = {
      ...(options.snap ? { snap: { ...options.snap } } : {}),
      ...(options.idFactory ? { idFactory: options.idFactory } : {}),
    }
  }

  getState(): EngineState {
    return clone({
      document: this.document,
      selection: this.selection,
      ...(this.tableCellSelection ? { tableCellSelection: this.tableCellSelection } : {}),
      guides: this.guides,
      history: { undoDepth: this.undoStack.length, redoDepth: this.redoStack.length },
    })
  }

  dispatch(command: EngineCommand): EngineState {
    this.guides = []
    switch (command.type) {
      case 'select': {
        const next = validSelection(this.document, command.elementIds)
        this.selection = command.additive ? validSelection(this.document, [...this.selection, ...next]) : next
        this.tableCellSelection = undefined
        break
      }
      case 'insertImage': {
        this.insertImage(command.slideId, command.element, command.asset)
        break
      }
      case 'insertImageReference': {
        this.insertImageReference(command.slideId, command.element, command.assetId)
        break
      }
      case 'replaceImageAsset': {
        this.replaceImageAsset(command.elementId, command.asset)
        break
      }
      case 'replaceImageAssetReference': {
        this.replaceImageAssetReference(command.elementId, command.assetId)
        break
      }
      case 'setImageRotation': {
        this.setImageRotation(command.elementId, command.rotation)
        break
      }
      case 'toggleImageFlip': {
        this.toggleImageFlip(command.elementId, command.axis)
        break
      }
      case 'selectTableCell': {
        this.selectTableCell(command.elementId, command.row, command.column, command.extend)
        break
      }
      case 'setTableCellText': {
        this.setTableCellText(command.body)
        break
      }
      case 'setTextBody': {
        this.setTextBody(command.elementId, command.body)
        break
      }
      case 'setTableCellFill': {
        this.setTableCellFill(command.fill)
        break
      }
      case 'setTableCellBorders': {
        this.setTableCellBorders(command.borders)
        break
      }
      case 'mergeTableCells': {
        this.mergeTableCells()
        break
      }
      case 'splitTableCell': {
        this.splitTableCell()
        break
      }
      case 'insertTableRow': {
        this.editTableStructure(command.elementId, { axis: 'row', mode: 'insert', index: command.index, count: command.count ?? 1 })
        break
      }
      case 'deleteTableRow': {
        this.editTableStructure(command.elementId, { axis: 'row', mode: 'delete', index: command.index, count: command.count ?? 1 })
        break
      }
      case 'insertTableColumn': {
        this.editTableStructure(command.elementId, { axis: 'column', mode: 'insert', index: command.index, count: command.count ?? 1 })
        break
      }
      case 'deleteTableColumn': {
        this.editTableStructure(command.elementId, { axis: 'column', mode: 'delete', index: command.index, count: command.count ?? 1 })
        break
      }
      case 'undo':
        this.applyHistoryEntry(this.undoStack, this.redoStack)
        break
      case 'redo':
        this.applyHistoryEntry(this.redoStack, this.undoStack)
        break
      case 'move':
        this.move(command.dx, command.dy)
        break
      case 'resize':
        this.resize(command.elementId, command.bounds)
        break
      case 'resizeSelection':
        this.resizeSelection(command.bounds)
        break
      case 'zOrder':
        this.zOrder(command.action)
        break
      case 'group':
        this.group()
        break
      case 'ungroup':
        this.ungroup(command.groupId)
        break
    }
    return this.getState()
  }

  private selectTableCell(elementId: string, row: number, column: number, extend = false): void {
    const element = this.document.elements[elementId]
    if (!element) throw new Error(`table element does not exist: ${elementId}`)
    if (element.kind !== 'table') throw new Error(`element is not a table: ${elementId}`)
    if (!Number.isInteger(row) || !Number.isInteger(column)) throw new Error(`table cell coordinate must use integers: ${elementId}[${row},${column}]`)
    if (row < 0 || row >= element.rows.length || column < 0 || column >= element.columns.length) {
      throw new Error(`table cell coordinate is outside table: ${elementId}[${row},${column}]`)
    }
    const source = sourceCellAt(element, row, column)
    if (!source) throw new Error(`table cell coordinate is outside table: ${elementId}[${row},${column}]`)
    const previous = extend && this.tableCellSelection?.elementId === elementId ? this.tableCellSelection : undefined
    this.selection = [elementId]
    this.tableCellSelection = {
      elementId,
      anchorRow: previous?.anchorRow ?? source.row,
      anchorColumn: previous?.anchorColumn ?? source.column,
      row: source.row,
      column: source.column,
    }
  }

  private setTableCellText(body: TextBody): void {
    const selection = validTableCellSelection(this.document, this.tableCellSelection)
    if (!selection) return
    const validation = validateTextBody(body)
    if (!validation.valid) throw new Error(`table cell body is invalid: ${validation.errors.join('; ')}`)
    const table = this.document.elements[selection.elementId]
    if (!table || table.kind !== 'table') throw new Error('no table cell is selected')
    const source = sourceCellAt(table, selection.row, selection.column)
    if (!source) throw new Error('no table cell is selected')
    this.commit([{ path: ['elements', selection.elementId, 'rows', String(source.row), 'cells', String(source.cellIndex), 'body'], value: body }])
  }

  private setTextBody(elementId: string, body: TextBody): void {
    const element = this.document.elements[elementId]
    if (!element) throw new Error(`element does not exist: ${elementId}`)
    if (element.kind !== 'text') throw new Error(`element is not text: ${elementId}`)
    const validation = validateTextBody(body)
    if (!validation.valid) throw new Error(`text body is invalid: ${validation.errors.join('; ')}`)
    this.commit([{ path: ['elements', elementId, 'body'], value: body }])
  }

  private selectedTableSourceCells(): { elementId: string; table: TableElement; sources: TableSourceCell[] } | undefined {
    const selection = validTableCellSelection(this.document, this.tableCellSelection)
    if (!selection) return undefined
    const table = this.document.elements[selection.elementId]
    if (!table || table.kind !== 'table') return undefined
    return { elementId: selection.elementId, table, sources: sourceCellsInSelection(table, selection) }
  }

  private setTableCellFill(fill: Fill | null): void {
    const selected = this.selectedTableSourceCells()
    if (!selected) return
    const changes = selected.sources.map((source) => ({
      path: ['elements', selected.elementId, 'rows', String(source.row), 'cells', String(source.cellIndex), 'fill'],
      value: fill ?? undefined,
    }))
    this.commitValidatedTableStyles(changes)
  }

  private setTableCellBorders(borders: Partial<Record<TableBorderSide, TableBorder | null>>): void {
    const selected = this.selectedTableSourceCells()
    if (!selected) return
    const suppliedSides = tableBorderSides.filter((side) => Object.prototype.hasOwnProperty.call(borders, side))
    if (suppliedSides.length === 0) return
    const changes = selected.sources.map((source) => {
      const cell = selected.table.rows[source.row]!.cells[source.cellIndex]!
      const nextBorders: TableCellBorders = { ...cell.borders }
      for (const side of suppliedSides) {
        const border = borders[side]
        if (border === null || border === undefined) delete nextBorders[side]
        else nextBorders[side] = border
      }
      return {
        path: ['elements', selected.elementId, 'rows', String(source.row), 'cells', String(source.cellIndex), 'borders'],
        value: Object.keys(nextBorders).length > 0 ? nextBorders : undefined,
      }
    })
    this.commitValidatedTableStyles(changes)
  }

  private mergeTableCells(): void {
    const selection = validTableCellSelection(this.document, this.tableCellSelection)
    if (!selection) return
    const element = this.document.elements[selection.elementId]
    if (!element || element.kind !== 'table') return
    const result = mergeTableSelection(element, selection)
    if (result.status === 'noop') return
    if (result.status === 'partial-overlap') throw new Error(`table merge selection partially covers merged cell: ${selection.elementId}`)
    this.commitTableReplacement(selection.elementId, result.table, 'merge', result.row, result.column)
  }

  private splitTableCell(): void {
    const selection = validTableCellSelection(this.document, this.tableCellSelection)
    if (!selection) return
    const element = this.document.elements[selection.elementId]
    if (!element || element.kind !== 'table') return
    const source = sourceCellAt(element, selection.row, selection.column)
    if (!source) return
    const table = splitTableSource(element, source)
    if (!table) return
    this.commitTableReplacement(selection.elementId, table, 'split', source.row, source.column)
  }

  private commitTableReplacement(elementId: string, table: TableElement, action: 'merge' | 'split', row: number, column: number): void {
    const nextDocument = clone(this.document)
    nextDocument.elements[elementId] = table
    const validation = validateDocument(nextDocument)
    if (!validation.valid) throw new Error(`table ${action} is invalid: ${elementId}: ${validation.errors.join('; ')}`)
    this.commit([{ path: ['elements', elementId], value: table }])
    this.tableCellSelection = { elementId, anchorRow: row, anchorColumn: column, row, column }
  }

  private commitValidatedTableStyles(changes: Array<{ path: string[]; value: unknown }>): void {
    const patch = makePatch(this.document, changes)
    if (patch.operations.length === 0) return
    const validation = validateDocument(applyPatch(this.document, patch))
    if (!validation.valid) throw new Error(`table cell style is invalid: ${validation.errors.join('; ')}`)
    this.commit(changes)
  }

  private editTableStructure(elementId: string, operation: TableStructureOperation): void {
    const element = this.document.elements[elementId]
    if (!element) throw new Error(`table element does not exist: ${elementId}`)
    if (element.kind !== 'table') throw new Error(`element is not a table: ${elementId}`)
    if (!Number.isFinite(operation.count) || !Number.isInteger(operation.count) || operation.count < 1) {
      throw new Error(`table structure count must be a positive integer: ${elementId}[${operation.count}]`)
    }
    const axisSize = operation.axis === 'row' ? element.rows.length : element.columns.length
    const axisName = operation.axis === 'row' ? 'row' : 'column'
    if (!Number.isFinite(operation.index) || !Number.isInteger(operation.index)) {
      throw new Error(`table ${axisName} ${operation.mode === 'insert' ? 'insertion index' : 'deletion range'} must use integers: ${elementId}[${operation.index}]`)
    }
    if (operation.mode === 'insert') {
      if (operation.index < 0 || operation.index > axisSize) throw new Error(`table ${axisName} insertion index is outside table: ${elementId}[${operation.index}]`)
    } else {
      const end = operation.index + operation.count
      if (operation.index < 0 || end > axisSize) throw new Error(`table ${axisName} deletion range is outside table: ${elementId}[${operation.index},${end})`)
      if (operation.count === axisSize) throw new Error(`table must keep at least one ${axisName}: ${elementId}`)
    }

    const result = transformTableStructure(element, operation)
    const nextDocument = clone(this.document)
    nextDocument.elements[elementId] = result.table
    const validation = validateDocument(nextDocument)
    if (!validation.valid) throw new Error(`table structure is invalid: ${validation.errors.join('; ')}`)

    const previousSelection = this.tableCellSelection?.elementId === elementId ? this.tableCellSelection : undefined
    this.commit([{ path: ['elements', elementId], value: result.table }])
    if (!previousSelection) return
    const anchor = result.mapPoint({ row: previousSelection.anchorRow, column: previousSelection.anchorColumn })
    const focus = result.mapPoint({ row: previousSelection.row, column: previousSelection.column })
    if (!anchor || !focus) {
      this.tableCellSelection = undefined
      return
    }
    const anchorSource = sourceCellAt(result.table, anchor.row, anchor.column)
    const focusSource = sourceCellAt(result.table, focus.row, focus.column)
    this.tableCellSelection = anchorSource && focusSource ? {
      elementId,
      anchorRow: anchorSource.row,
      anchorColumn: anchorSource.column,
      row: focusSource.row,
      column: focusSource.column,
    } : undefined
  }

  private move(dx: number, dy: number): void {
    const selectedIds = validSelection(this.document, this.selection)
    const bounds = selectionBounds(this.document, selectedIds)
    if (!bounds || !Number.isFinite(dx) || !Number.isFinite(dy)) return
    const xSnap = nearestSnap(this.document, selectedIds, bounds, 'x', dx, this.options.snap)
    const ySnap = nearestSnap(this.document, selectedIds, bounds, 'y', dy, this.options.snap)
    const adjustedDx = dx + (xSnap?.delta ?? 0)
    const adjustedDy = dy + (ySnap?.delta ?? 0)
    this.guides = [
      ...(xSnap ? [{ axis: 'x' as const, position: xSnap.position, source: xSnap.source, ...(xSnap.elementId ? { elementId: xSnap.elementId } : {}) }] : []),
      ...(ySnap ? [{ axis: 'y' as const, position: ySnap.position, source: ySnap.source, ...(ySnap.elementId ? { elementId: ySnap.elementId } : {}) }] : []),
    ]
    const movedIds = selectedIds.flatMap((elementId) => descendantElementIds(this.document, elementId))
    this.commit(movedIds.flatMap((elementId) => {
      const element = this.document.elements[elementId]
      if (!element) return []
      return {
        path: ['elements', elementId, 'bounds'],
        value: { ...element.bounds, x: element.bounds.x + adjustedDx, y: element.bounds.y + adjustedDy },
      }
    }))
  }

  private resize(elementId: string, bounds: Rect): void {
    if (bounds.w <= 0 || bounds.h <= 0) throw new Error('bounds must be positive')
    if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.w) || !Number.isFinite(bounds.h)) throw new Error('bounds must be finite')
    const element = this.document.elements[elementId]
    if (!element) return
    if (element.kind !== 'group') {
      this.commit([{ path: ['elements', elementId, 'bounds'], value: bounds }])
      return
    }
    const previous = element.bounds
    const scaleX = bounds.w / previous.w
    const scaleY = bounds.h / previous.h
    const mapBounds = (source: Rect): Rect => ({
      x: bounds.x + (source.x - previous.x) * scaleX,
      y: bounds.y + (source.y - previous.y) * scaleY,
      w: source.w * scaleX,
      h: source.h * scaleY,
    })
    const descendantIds = descendantElementIds(this.document, elementId)
    this.commit(descendantIds.map((descendantId) => ({
      path: ['elements', descendantId, 'bounds'],
      value: descendantId === elementId ? bounds : mapBounds(this.document.elements[descendantId]!.bounds),
    })))
  }

  private resizeSelection(bounds: Rect): void {
    if (bounds.w <= 0 || bounds.h <= 0) throw new Error('bounds must be positive')
    if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.w) || !Number.isFinite(bounds.h)) throw new Error('bounds must be finite')
    const roots = selectionRoots(this.document, this.selection)
    const previous = selectionBounds(this.document, roots)
    if (!previous) return
    const scaleX = bounds.w / previous.w
    const scaleY = bounds.h / previous.h
    const mappedIds = [...new Set(roots.flatMap((rootId) => descendantElementIds(this.document, rootId)))]
    this.commit(mappedIds.map((elementId) => {
      const source = this.document.elements[elementId]
      if (!source) return { path: ['elements', elementId, 'bounds'], value: undefined }
      return {
        path: ['elements', elementId, 'bounds'],
        value: {
          x: bounds.x + (source.bounds.x - previous.x) * scaleX,
          y: bounds.y + (source.bounds.y - previous.y) * scaleY,
          w: source.bounds.w * scaleX,
          h: source.bounds.h * scaleY,
        },
      }
    }))
  }

  private zOrder(action: 'front' | 'back' | 'forward' | 'backward'): void {
    const slide = this.activeSlide()
    if (!slide) return
    const selected = new Set(this.selection)
    const selectedIds = slide.elementIds.filter((elementId) => selected.has(elementId))
    if (selectedIds.length === 0) return
    const remaining = slide.elementIds.filter((elementId) => !selected.has(elementId))
    let elementIds: string[]
    if (action === 'front') elementIds = [...remaining, ...selectedIds]
    else if (action === 'back') elementIds = [...selectedIds, ...remaining]
    else {
      const current = [...slide.elementIds]
      const direction = action === 'forward' ? 1 : -1
      const indexes = selectedIds.map((elementId) => current.indexOf(elementId))
      const orderedIndexes = direction > 0 ? [...indexes].reverse() : indexes
      for (const index of orderedIndexes) {
        const nextIndex = index + direction
        const nextId = current[nextIndex]
        if (nextIndex < 0 || nextIndex >= current.length || !nextId || selected.has(nextId)) continue
        const currentId = current[index]!
        current[index] = nextId
        current[nextIndex] = currentId
      }
      elementIds = current
    }
    this.commit([{ path: ['slides', slide.id, 'elementIds'], value: elementIds }])
  }

  private group(): void {
    const slide = this.activeSlide()
    const selectedIds = slide?.elementIds.filter((elementId) => this.selection.includes(elementId)) ?? []
    if (!slide || selectedIds.length < 2) return
    const bounds = selectionBounds(this.document, selectedIds)
    if (!bounds) return
    const idFactory = this.options.idFactory
    let groupId = idFactory ? idFactory('grp') : `grp_${this.groupSequence++}`
    while (this.document.elements[groupId]) {
      groupId = idFactory ? idFactory('grp') : `grp_${this.groupSequence++}`
    }
    const firstIndex = slide.elementIds.indexOf(selectedIds[0]!)
    const nextElementIds = slide.elementIds.filter((elementId) => !selectedIds.includes(elementId))
    nextElementIds.splice(firstIndex, 0, groupId)
    this.commit([
      { path: ['slides', slide.id, 'elementIds'], value: nextElementIds },
      { path: ['elements', groupId], value: { id: groupId, kind: 'group', bounds, childIds: selectedIds } },
    ])
    this.selection = [groupId]
  }

  private ungroup(groupId: string): void {
    const slide = this.activeSlide()
    const group = this.document.elements[groupId]
    if (!slide || !group || group.kind !== 'group') return
    const index = slide.elementIds.indexOf(groupId)
    if (index === -1) return
    const nextElementIds = [...slide.elementIds]
    nextElementIds.splice(index, 1, ...group.childIds)
    this.commit([
      { path: ['slides', slide.id, 'elementIds'], value: nextElementIds },
      { path: ['elements', groupId], value: undefined },
    ])
    this.selection = [...group.childIds]
  }

  private activeSlide(): Ppt4aiDocument['slides'][string] | undefined {
    const slideId = this.document.slideOrder[0]
    return slideId ? this.document.slides[slideId] : undefined
  }

  private insertImage(slideId: string, element: ImageElement, asset: AssetMetadata): void {
    const slide = this.document.slides[slideId]
    if (!slide) throw new Error(`slide does not exist: ${slideId}`)
    if (this.document.elements[element.id]) throw new Error(`element already exists: ${element.id}`)
    if (this.document.assets?.[asset.id]) throw new Error(`asset already exists: ${asset.id}`)
    if (element.assetId !== asset.id) throw new Error(`image element asset does not match metadata: ${element.id}`)

    const nextDocument = clone(this.document)
    nextDocument.assets = { ...(nextDocument.assets ?? {}), [asset.id]: clone(asset) }
    nextDocument.elements[element.id] = clone(element)
    nextDocument.slides[slideId]!.elementIds = [...slide.elementIds, element.id]
    const validation = validateDocument(nextDocument)
    if (!validation.valid) throw new Error(`image insertion is invalid: ${validation.errors.join('; ')}`)

    this.commit([
      { path: ['assets'], value: nextDocument.assets },
      { path: ['elements', element.id], value: nextDocument.elements[element.id] },
      { path: ['slides', slideId, 'elementIds'], value: nextDocument.slides[slideId]!.elementIds },
    ])
    this.selection = [element.id]
    this.tableCellSelection = undefined
  }

  private insertImageReference(slideId: string, element: ImageElement, assetId: string): void {
    const slide = this.document.slides[slideId]
    if (!slide) throw new Error(`slide does not exist: ${slideId}`)
    if (this.document.elements[element.id]) throw new Error(`element already exists: ${element.id}`)
    if (!this.document.assets?.[assetId]) throw new Error(`asset does not exist: ${assetId}`)
    if (element.assetId !== assetId) throw new Error(`image element asset does not match reference: ${element.id}`)

    const nextDocument = clone(this.document)
    nextDocument.elements[element.id] = clone(element)
    nextDocument.slides[slideId]!.elementIds = [...slide.elementIds, element.id]
    const validation = validateDocument(nextDocument)
    if (!validation.valid) throw new Error(`image insertion is invalid: ${validation.errors.join('; ')}`)

    this.commit([
      { path: ['elements', element.id], value: nextDocument.elements[element.id] },
      { path: ['slides', slideId, 'elementIds'], value: nextDocument.slides[slideId]!.elementIds },
    ])
    this.selection = [element.id]
    this.tableCellSelection = undefined
  }

  private replaceImageAsset(elementId: string, asset: AssetMetadata): void {
    const element = this.document.elements[elementId]
    if (!element) throw new Error(`element does not exist: ${elementId}`)
    if (element.kind !== 'image') throw new Error(`element is not an image: ${elementId}`)
    if (element.assetId === asset.id) throw new Error(`replacement asset must differ: ${asset.id}`)
    if (this.document.assets?.[asset.id]) throw new Error(`asset already exists: ${asset.id}`)

    const nextDocument = clone(this.document)
    nextDocument.elements[elementId] = { ...element, assetId: asset.id }
    nextDocument.assets = { ...(nextDocument.assets ?? {}), [asset.id]: clone(asset) }
    const stillReferenced = Object.values(nextDocument.elements).some((candidate) => candidate.kind === 'image' && candidate.assetId === element.assetId)
    if (!stillReferenced) delete nextDocument.assets[element.assetId]
    const validation = validateDocument(nextDocument)
    if (!validation.valid) throw new Error(`image replacement is invalid: ${validation.errors.join('; ')}`)

    this.commit([
      { path: ['assets'], value: nextDocument.assets },
      { path: ['elements', elementId], value: nextDocument.elements[elementId] },
    ])
  }

  private replaceImageAssetReference(elementId: string, assetId: string): void {
    const element = this.document.elements[elementId]
    if (!element) throw new Error(`element does not exist: ${elementId}`)
    if (element.kind !== 'image') throw new Error(`element is not an image: ${elementId}`)
    if (element.assetId === assetId) throw new Error(`replacement asset must differ: ${assetId}`)
    if (!this.document.assets?.[assetId]) throw new Error(`asset does not exist: ${assetId}`)

    const nextDocument = clone(this.document)
    nextDocument.elements[elementId] = { ...element, assetId }
    const stillReferenced = Object.values(nextDocument.elements).some((candidate) => candidate.kind === 'image' && candidate.assetId === element.assetId)
    if (!stillReferenced) {
      nextDocument.assets = { ...(nextDocument.assets ?? {}) }
      delete nextDocument.assets[element.assetId]
    }
    const validation = validateDocument(nextDocument)
    if (!validation.valid) throw new Error(`image replacement is invalid: ${validation.errors.join('; ')}`)

    this.commit([
      { path: ['assets'], value: nextDocument.assets },
      { path: ['elements', elementId], value: nextDocument.elements[elementId] },
    ])
  }

  private setImageRotation(elementId: string, rotation: number): void {
    const element = this.document.elements[elementId]
    if (!element) throw new Error(`element does not exist: ${elementId}`)
    if (element.kind !== 'image') throw new Error(`element is not an image: ${elementId}`)
    if (!Number.isInteger(rotation)) throw new Error('rotation must be an integer')
    const transform = this.normalizeImageTransform({ ...element.transform, rotation })
    this.commitImageTransform(elementId, transform)
  }

  private toggleImageFlip(elementId: string, axis: ImageFlipAxis): void {
    const element = this.document.elements[elementId]
    if (!element) throw new Error(`element does not exist: ${elementId}`)
    if (element.kind !== 'image') throw new Error(`element is not an image: ${elementId}`)
    if (axis !== 'horizontal' && axis !== 'vertical') throw new Error(`unsupported image flip axis: ${String(axis)}`)
    const transform: ElementTransform = { ...element.transform }
    if (axis === 'horizontal') transform.flipH = !transform.flipH
    else transform.flipV = !transform.flipV
    this.commitImageTransform(elementId, this.normalizeImageTransform(transform))
  }

  private normalizeImageTransform(transform: ElementTransform): ElementTransform | undefined {
    const normalized = { ...transform }
    if (normalized.rotation === 0) delete normalized.rotation
    if (!normalized.flipH) delete normalized.flipH
    if (!normalized.flipV) delete normalized.flipV
    return Object.keys(normalized).length > 0 ? normalized : undefined
  }

  private commitImageTransform(elementId: string, transform: ElementTransform | undefined): void {
    const nextDocument = clone(this.document)
    const element = nextDocument.elements[elementId]
    if (!element || element.kind !== 'image') throw new Error(`element is not an image: ${elementId}`)
    if (transform) element.transform = clone(transform)
    else delete element.transform
    const validation = validateDocument(nextDocument)
    if (!validation.valid) throw new Error(`image transform is invalid: ${elementId}: ${validation.errors.join('; ')}`)
    this.commit([{ path: ['elements', elementId, 'transform'], value: transform }])
  }

  private applyHistoryEntry(source: HistoryEntry[], target: HistoryEntry[]): void {
    const entry = source.pop()
    if (!entry) return
    const patch = source === this.undoStack ? entry.inverse : entry.patch
    this.document = applyPatch(this.document, patch)
    this.selection = validSelection(this.document, this.selection)
    this.tableCellSelection = validTableCellSelection(this.document, this.tableCellSelection)
    target.push(entry)
  }

  protected commit(changes: Array<{ path: string[]; value: unknown }>): void {
    const patch = makePatch(this.document, changes)
    if (patch.operations.length === 0) return
    this.document = applyPatch(this.document, patch)
    this.undoStack.push({ patch, inverse: inversePatch(patch) })
    this.redoStack = []
  }
}

export type EngineElement = Element

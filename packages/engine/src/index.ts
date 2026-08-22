import type { Element, Ppt4aiDocument, Rect, TableElement } from '@ppt4ai/model'

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

export type EngineCommand =
  | { type: 'select'; elementIds: string[]; additive?: boolean }
  | { type: 'selectTableCell'; elementId: string; row: number; column: number; extend?: boolean }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'move'; dx: number; dy: number }
  | { type: 'resize'; elementId: string; bounds: Rect }
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

function validTableCellSelection(document: Ppt4aiDocument, selection: TableCellSelection | undefined): TableCellSelection | undefined {
  if (!selection) return undefined
  const element = document.elements[selection.elementId]
  if (!element || element.kind !== 'table') return undefined
  if (!sourceCellAt(element, selection.anchorRow, selection.anchorColumn) || !sourceCellAt(element, selection.row, selection.column)) return undefined
  return selection
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
      case 'selectTableCell': {
        this.selectTableCell(command.elementId, command.row, command.column, command.extend)
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
    this.commit(selectedIds.flatMap((elementId) => {
      const element = this.document.elements[elementId]
      if (!element) return []
      return [{
        path: ['elements', elementId, 'bounds'],
        value: { ...element.bounds, x: element.bounds.x + adjustedDx, y: element.bounds.y + adjustedDy },
      }]
    }))
  }

  private resize(elementId: string, bounds: Rect): void {
    if (bounds.w <= 0 || bounds.h <= 0) throw new Error('bounds must be positive')
    if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.w) || !Number.isFinite(bounds.h)) throw new Error('bounds must be finite')
    if (!this.document.elements[elementId]) return
    this.commit([{ path: ['elements', elementId, 'bounds'], value: bounds }])
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

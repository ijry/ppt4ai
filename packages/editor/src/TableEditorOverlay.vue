<script setup lang="ts">
import type { SceneTableNode } from '@ppt4ai/render'
import { computed, nextTick, ref } from 'vue'
import type { TextViewportTransform } from './text-editor-interaction'
import {
  createTableEditorOverlay,
  selectedTableCells,
  tableCellAtPoint,
  type TableCellPoint,
  type TableCellSelection,
  type TableEditorCell,
} from './table-editor-overlay'

const props = defineProps<{
  active: boolean
  table: SceneTableNode
  transform: TextViewportTransform
}>()

const emit = defineEmits<{
  select: [selection: TableCellSelection]
  selectEnd: [selection: TableCellSelection]
}>()

const model = computed(() => createTableEditorOverlay(props.table, props.transform))
const selection = ref<TableCellSelection>()
const focusedPoint = ref<TableCellPoint>()
const pointerId = ref<number>()
const dragging = ref(false)

const focusedKey = computed(() => pointKey(focusedPoint.value ?? model.value.cells[0]?.point))
const selectedKeys = computed(() => new Set(
  selection.value
    ? selectedTableCells(model.value.cells, selection.value).map((cell) => pointKey(cell.point))
    : [],
))

function pointKey(point?: TableCellPoint): string {
  return point ? `${point.row}:${point.column}` : ''
}

function clonePoint(point: TableCellPoint): TableCellPoint {
  return { row: point.row, column: point.column }
}

function collapsedSelection(point: TableCellPoint): TableCellSelection {
  return { anchor: clonePoint(point), focus: clonePoint(point) }
}

function emitSelection(eventName: 'select' | 'selectEnd', value: TableCellSelection): void {
  const payload = {
    anchor: clonePoint(value.anchor),
    focus: clonePoint(value.focus),
  }
  if (eventName === 'select') emit('select', payload)
  else emit('selectEnd', payload)
}

function cellAtEvent(event: PointerEvent): TableEditorCell | undefined {
  return tableCellAtPoint(model.value, { x: event.clientX, y: event.clientY })
}

function focusCell(grid: HTMLElement, point: TableCellPoint): void {
  void nextTick(() => {
    const cell = grid.querySelector<HTMLElement>(
      `[data-table-cell-row="${point.row}"][data-table-cell-column="${point.column}"]`,
    )
    cell?.focus()
  })
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  const cell = cellAtEvent(event)
  if (!cell) return
  event.preventDefault()
  const grid = event.currentTarget as HTMLElement
  const nextSelection = collapsedSelection(cell.point)
  selection.value = nextSelection
  focusedPoint.value = clonePoint(cell.point)
  pointerId.value = event.pointerId
  dragging.value = true
  grid.setPointerCapture?.(event.pointerId)
  focusCell(grid, cell.point)
  emitSelection('select', nextSelection)
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return
  const cell = cellAtEvent(event)
  const current = selection.value
  if (!cell || !current || pointKey(cell.point) === pointKey(current.focus)) return
  const nextSelection = {
    anchor: clonePoint(current.anchor),
    focus: clonePoint(cell.point),
  }
  selection.value = nextSelection
  emitSelection('select', nextSelection)
}

function finishPointer(event: PointerEvent): void {
  const current = selection.value
  if (!dragging.value || !current) return
  dragging.value = false
  const grid = event.currentTarget as HTMLElement
  const capturedPointerId = pointerId.value
  pointerId.value = undefined
  if (capturedPointerId !== undefined) grid.releasePointerCapture?.(capturedPointerId)
  emitSelection('selectEnd', current)
}

function activateCell(event: KeyboardEvent, cell: TableEditorCell): void {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  const nextSelection = collapsedSelection(cell.point)
  focusedPoint.value = clonePoint(cell.point)
  selection.value = nextSelection
  emitSelection('select', nextSelection)
  emitSelection('selectEnd', nextSelection)
}

function cellStyle(cell: TableEditorCell): Record<string, string> {
  return {
    left: `${cell.rect.x - model.value.bounds.x}px`,
    top: `${cell.rect.y - model.value.bounds.y}px`,
    width: `${cell.rect.width}px`,
    height: `${cell.rect.height}px`,
  }
}

function cellLabel(cell: TableEditorCell): string {
  return `Table cell row ${cell.point.row + 1}, column ${cell.point.column + 1}, row span ${cell.rowSpan}, column span ${cell.colSpan}`
}
</script>

<template>
  <div
    v-if="props.active"
    role="grid"
    class="ppt-table-editor-overlay absolute touch-none select-none"
    data-table-editor-overlay
    :style="{
      left: `${model.bounds.x}px`,
      top: `${model.bounds.y}px`,
      width: `${model.bounds.width}px`,
      height: `${model.bounds.height}px`,
    }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="finishPointer"
    @pointercancel="finishPointer"
  >
    <div class="pointer-events-none absolute inset-0 border-2 border-blue-500" data-table-border />
    <div
      v-for="cell in model.cells"
      :key="pointKey(cell.point)"
      role="gridcell"
      data-table-cell
      :data-table-cell-row="cell.point.row"
      :data-table-cell-column="cell.point.column"
      :data-table-cell-source="pointKey(cell.point)"
      :aria-label="cellLabel(cell)"
      :tabindex="focusedKey === pointKey(cell.point) ? 0 : -1"
      :class="[
        'absolute cursor-cell outline-none focus:ring-2 focus:ring-blue-500',
        selectedKeys.has(pointKey(cell.point)) ? 'bg-blue-500/15 ring-2 ring-inset ring-blue-500' : '',
      ]"
      :style="cellStyle(cell)"
      @focus="focusedPoint = clonePoint(cell.point)"
      @keydown="activateCell($event, cell)"
    />
  </div>
</template>

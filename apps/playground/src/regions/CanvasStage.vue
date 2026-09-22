<script setup lang="ts">
import { computed } from 'vue'
import { PptEditor, type TableCellSelection } from '@ppt4ai/editor'
import type { Fill, StrokeStyle, TableBorder, TextBody } from '@ppt4ai/model'
import { stageBindings } from '../editor/stage-bindings'
import type { PlaygroundPresentationHost, PlaygroundPresentationSnapshot } from '../presentation-host'

const props = defineProps<{ snapshot: PlaygroundPresentationSnapshot; host: PlaygroundPresentationHost; zoom: number }>()
const emit = defineEmits<{ update: [PlaygroundPresentationSnapshot] }>()

const b = computed(() => stageBindings(props.snapshot))
const tableCellSelection = computed(() => {
  const s = props.snapshot.slides[props.snapshot.activeSlideId]!.engineState.tableCellSelection
  return s ? { elementId: s.elementId, row: s.row, column: s.column } : undefined
})

function selectElements(p: { elementIds: string[] }): void { emit('update', props.host.selectElements(p.elementIds)) }
function groupSelected(): void { emit('update', props.host.groupSelected()) }
function ungroupSelected(p: { groupId: string }): void { emit('update', props.host.ungroupSelected(p.groupId)) }
function resizeSelected(p: { elementIds: string[]; bounds: { x: number; y: number; w: number; h: number } }): void { emit('update', props.host.resizeSelected(p.elementIds, p.bounds)) }
function moveElement(p: { nodeId: string; dx: number; dy: number }): void { if (p.dx === 0 && p.dy === 0) return; emit('update', props.host.moveSelected(p.nodeId, p.dx, p.dy)) }
function resizeElement(p: { elementId: string; bounds: { x: number; y: number; w: number; h: number } }): void { emit('update', props.host.resizeElement(p.elementId, p.bounds)) }
function rotateImage(p: { elementId: string; rotation: number }): void { emit('update', props.host.rotateSelectedImage(p.elementId, p.rotation)) }
function rotateElement(p: { elementId: string; rotation: number }): void { emit('update', props.host.rotateSelectedElement(p.elementId, p.rotation)) }
function rotateSelection(p: { rotation: number }): void { emit('update', props.host.rotateSelection(p.rotation)) }
function flipImage(p: { elementId: string; axis: 'horizontal' | 'vertical' }): void { emit('update', props.host.toggleSelectedImageFlip(p.elementId, p.axis)) }
function flipElement(p: { elementId: string; axis: 'horizontal' | 'vertical' }): void { emit('update', props.host.toggleSelectedElementFlip(p.elementId, p.axis)) }
function flipSelection(p: { axis: 'horizontal' | 'vertical' }): void { emit('update', props.host.flipSelection(p.axis)) }
function updateTextElement(p: { elementId: string; body: TextBody }): void { emit('update', props.host.updateTextElement(p.elementId, p.body)) }
function setShapeFill(fill: Fill | null): void { emit('update', props.host.setSelectedFill(fill)) }
function setShapeStroke(stroke: Fill | null): void { emit('update', props.host.setSelectedStroke(stroke)) }
function setShapeStrokeWidth(width: number | null): void { emit('update', props.host.setSelectedStrokeWidth(width)) }
function setShapeStrokeStyle(style: StrokeStyle | null): void { emit('update', props.host.setSelectedStrokeStyle(style)) }
function selectTableCell(p: { elementId: string; selection: TableCellSelection }): void {
  const extend = p.selection.anchor.row !== p.selection.focus.row || p.selection.anchor.column !== p.selection.focus.column
  emit('update', props.host.selectTableCell(p.elementId, p.selection.focus.row, p.selection.focus.column, extend))
}
function setTableCellFill(fill: Fill | null): void { emit('update', props.host.setTableCellFill(fill)) }
function setTableCellBorders(borders: Partial<Record<'left' | 'right' | 'top' | 'bottom', TableBorder | null>>): void { emit('update', props.host.setTableCellBorders(borders)) }
function setTableCellText(p: { elementId: string; point: { row: number; column: number }; body: TextBody }): void { emit('update', props.host.setTableCellText(p.elementId, p.point.row, p.point.column, p.body)) }
</script>
<template>
  <div data-region="stage" class="flex items-start justify-center p-6">
    <PptEditor
      :scene="b.scene" :adapter="props.host.adapter" :snap-options="props.host.snapOptions"
      :selected-element-id="b.selectedElementId" :selected-element-ids="b.selectedElementIds"
      :table-cell-selection="tableCellSelection" :text-bodies="b.textBodies"
      :zoom="props.zoom" :show-object-toolbar="false"
      @selection-change="selectElements" @group="groupSelected" @ungroup="ungroupSelected"
      @resize-selection="resizeSelected" @move-end="moveElement" @resize="resizeElement"
      @rotate-image="rotateImage" @rotate-element="rotateElement" @rotate-selection="rotateSelection"
      @flip-image="flipImage" @flip-element="flipElement" @flip-selection="flipSelection"
      @text-edit="updateTextElement" @set-fill="setShapeFill" @set-stroke="setShapeStroke"
      @set-stroke-width="setShapeStrokeWidth" @set-stroke-style="setShapeStrokeStyle"
      @select-table-cell="selectTableCell" @set-table-cell-fill="setTableCellFill"
      @set-table-cell-borders="setTableCellBorders" @table-cell-text="setTableCellText"
    />
  </div>
</template>

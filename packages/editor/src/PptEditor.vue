<script setup lang="ts">
import type { SnapGuide, SnapOptions } from '@ppt4ai/engine'
import type { AssetAdapter, Rect, TextBody } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import type { ImeInputBridge, ImeInputBridgeOptions } from '@ppt4ai/text'
import { computed, onBeforeUnmount, ref, shallowRef, toRaw, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SlideCanvas from './SlideCanvas.vue'
import SelectionOverlay from './SelectionOverlay.vue'
import TextBoxEditor from './TextBoxEditor.vue'
import type { ImageDecoder } from './image-canvas-renderer'
import { createSelectionOverlay, resizeBounds, resizeBoundsWithAspectRatio, type Point, type ResizePointerPayload, type SelectionHandle } from './selection-overlay'
import type { CanvasSelectionIntent } from './slide-canvas'
import { snapResizeBounds } from './resize-snapping'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  scene?: SceneGraph
  adapter?: AssetAdapter
  decoder?: ImageDecoder
  selectedElementId?: string
  selectedElementIds?: string[]
  snapOptions?: SnapOptions
  textBodies?: Record<string, TextBody>
  bridgeFactory?: (options: ImeInputBridgeOptions) => ImeInputBridge
  zoom?: number
  devicePixelRatio?: number
}>(), { zoom: 1 })

const emit = defineEmits<{
  select: [nodeId: string | undefined]
  'selection-change': [payload: { elementIds: string[] }]
  render: [result: unknown]
  'move-start': [payload: { nodeId: string; point: Point }]
  move: [payload: { nodeId: string; dx: number; dy: number }]
  'move-end': [payload: { nodeId: string; dx: number; dy: number }]
  resize: [payload: { elementId: string; bounds: { x: number; y: number; w: number; h: number } }]
  'resize-selection': [payload: { elementIds: string[]; bounds: Rect }]
  'text-edit': [payload: { elementId: string; body: TextBody }]
  group: []
  ungroup: [payload: { groupId: string }]
}>()

const EMU_TO_CSS_PIXEL = 96 / 914400

type ScreenBounds = Rect

function elementBounds(elementId: string): Rect | undefined {
  return props.scene?.groups?.find((entry) => entry.id === elementId)?.bounds
    ?? props.scene?.nodes.find((entry) => entry.id === elementId)?.bounds
}

function isInteractiveElementId(elementId: string): boolean {
  const currentGroupId = groupPath.value[groupPath.value.length - 1]
  if (currentGroupId) {
    return props.scene?.groups?.find((group) => group.id === currentGroupId)?.childIds.includes(elementId) ?? false
  }
  const group = props.scene?.groups?.find((entry) => entry.id === elementId)
  if (group) return group.ancestorIds.length === 0
  return Boolean(props.scene?.nodes.some((entry) => entry.id === elementId))
    && !props.scene?.groups?.some((entry) => entry.childIds.includes(elementId))
}

const selectedElementIds = computed(() => {
  const source = props.selectedElementIds !== undefined
    ? props.selectedElementIds
    : props.selectedElementId ? [props.selectedElementId] : []
  return source.filter((id, index) => source.indexOf(id) === index && isInteractiveElementId(id) && elementBounds(id))
})

function toScreenBounds(bounds: Rect): ScreenBounds {
  const scale = EMU_TO_CSS_PIXEL * props.zoom
  return { x: bounds.x * scale, y: bounds.y * scale, w: bounds.w * scale, h: bounds.h * scale }
}

function unionBounds(bounds: Rect[]): Rect {
  const left = Math.min(...bounds.map((entry) => entry.x))
  const top = Math.min(...bounds.map((entry) => entry.y))
  const right = Math.max(...bounds.map((entry) => entry.x + entry.w))
  const bottom = Math.max(...bounds.map((entry) => entry.y + entry.h))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

function selectedDocumentBounds(): Rect | undefined {
  const bounds = selectedElementIds.value.map(elementBounds).filter((entry): entry is Rect => Boolean(entry))
  if (bounds.length === 0) return undefined
  return bounds.length === 1 ? bounds[0]! : unionBounds(bounds)
}

function selectedBounds(): ScreenBounds | undefined {
  const bounds = selectedDocumentBounds()
  if (!bounds) return undefined
  return toScreenBounds(bounds)
}

function emitSelection(elementIds: string[]): void {
  emit('selection-change', { elementIds })
  emit('select', elementIds.length === 1 ? elementIds[0] : undefined)
}

const isInsideGroup = computed(() => groupPath.value.length > 0)
const selectedGroupId = computed(() => {
  if (selectedElementIds.value.length !== 1) return undefined
  const elementId = selectedElementIds.value[0]!
  return props.scene?.groups?.some((group) => group.id === elementId && group.ancestorIds.length === 0)
    ? elementId
    : undefined
})
const canGroup = computed(() => !isInsideGroup.value && selectedElementIds.value.length >= 2)
const canUngroup = computed(() => !isInsideGroup.value && Boolean(selectedGroupId.value))

function ungroupSelected(): void {
  if (selectedGroupId.value) emit('ungroup', { groupId: selectedGroupId.value })
}

const resizePreview = ref<{ elementIds: string[]; bounds: ScreenBounds; guides: SnapGuide[] }>()
const resizeGesture = ref<{
  elementIds: string[]
  handle: SelectionHandle
  startBounds: ScreenBounds
  startDocumentBounds: Rect
  startPoint: Point
  shiftKey: boolean
}>()
const editingElementId = ref<string>()
const editingDraft = shallowRef<TextBody>()
const editingComposing = ref(false)
const groupPath = ref<string[]>([])
let pendingTextClose: 'commit' | 'cancel' | undefined
let textCloseScheduled = false
let pendingSelectedMemberId: string | undefined

function cloneBody(body: TextBody): TextBody {
  return structuredClone(toRaw(body))
}

function activate(nodeId: string): void {
  const node = props.scene?.nodes.find((entry) => entry.id === nodeId)
  const body = props.textBodies?.[nodeId]
  if (node?.kind !== 'text' || !body) return
  emitSelection([nodeId])
  editingElementId.value = nodeId
  editingDraft.value = cloneBody(body)
  editingComposing.value = false
  pendingTextClose = undefined
}

function enterGroup(groupId: string): void {
  groupPath.value = [...groupPath.value, groupId]
  emitSelection([groupId])
}

function handleEditorKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || editingElementId.value || groupPath.value.length === 0) return
  event.preventDefault()
  const nextPath = groupPath.value.slice(0, -1)
  groupPath.value = nextPath
  emitSelection(nextPath.length > 0 ? [nextPath[nextPath.length - 1]!] : [])
}

function normalizeGroupPath(): void {
  const groups = props.scene?.groups ?? []
  let parentId: string | undefined
  const normalized: string[] = []
  for (const id of groupPath.value) {
    const group = groups.find((entry) => entry.id === id)
    if (!group || (parentId ? group.ancestorIds[group.ancestorIds.length - 1] !== parentId : group.ancestorIds.length !== 0)) break
    normalized.push(id)
    parentId = id
  }
  groupPath.value = normalized
}

function select(intent: CanvasSelectionIntent): void {
  const { nodeId } = intent
  pendingSelectedMemberId = undefined
  const currentGroupId = groupPath.value[groupPath.value.length - 1]
  const currentGroup = props.scene?.groups?.find((group) => group.id === currentGroupId)
  if (groupPath.value.length > 0) {
    if (!nodeId || !currentGroup?.childIds.includes(nodeId)) groupPath.value = []
    emitSelection(nodeId ? [nodeId] : [])
    return
  }
  if (intent.toggle) {
    if (!nodeId) return
    emitSelection(selectedElementIds.value.includes(nodeId)
      ? selectedElementIds.value.filter((id) => id !== nodeId)
      : [...selectedElementIds.value, nodeId])
    return
  }
  if (nodeId && selectedElementIds.value.length > 1 && selectedElementIds.value.includes(nodeId)) {
    pendingSelectedMemberId = nodeId
    return
  }
  emitSelection(nodeId ? [nodeId] : [])
}

function move(payload: { nodeId: string; dx: number; dy: number }): void {
  if (payload.dx !== 0 || payload.dy !== 0) pendingSelectedMemberId = undefined
  emit('move', payload)
}

function moveEnd(payload: { nodeId: string; dx: number; dy: number }): void {
  const selectedMemberId = pendingSelectedMemberId
  pendingSelectedMemberId = undefined
  if (selectedMemberId && payload.dx === 0 && payload.dy === 0) emitSelection([selectedMemberId])
  emit('move-end', payload)
}

function updateEditingDraft(body: TextBody): void {
  if (!editingElementId.value) return
  editingDraft.value = cloneBody(body)
}

function closeTextEditing(action: 'commit' | 'cancel'): void {
  const elementId = editingElementId.value
  const body = editingDraft.value
  if (!elementId) return
  editingElementId.value = undefined
  editingDraft.value = undefined
  editingComposing.value = false
  pendingTextClose = undefined
  if (action === 'commit' && body) emit('text-edit', { elementId, body: cloneBody(body) })
}

function scheduleTextClose(action: 'commit' | 'cancel'): void {
  if (!editingElementId.value) return
  pendingTextClose = action
  if (editingComposing.value || textCloseScheduled) return
  textCloseScheduled = true
  queueMicrotask(() => {
    textCloseScheduled = false
    const requested = pendingTextClose
    if (requested && !editingComposing.value) closeTextEditing(requested)
  })
}

function updateEditingComposing(value: boolean): void {
  editingComposing.value = value
  if (!value && pendingTextClose) scheduleTextClose(pendingTextClose)
}

function handleTextKeyDown(event: KeyboardEvent): void {
  const action = event.key === 'Escape'
    ? 'cancel'
    : event.key === 'Enter' && event.ctrlKey
      ? 'commit'
      : undefined
  if (!action) return
  event.preventDefault()
  event.stopPropagation()
  if (editingComposing.value) scheduleTextClose(action)
  else closeTextEditing(action)
}

function handleTextFocusOut(event: FocusEvent): void {
  const nextTarget = event.relatedTarget
  if (nextTarget instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
  scheduleTextClose('commit')
}

const editingNode = computed(() => props.scene?.nodes.find((entry) => entry.id === editingElementId.value && entry.kind === 'text'))
const textEditorProps = computed(() => {
  const node = editingNode.value
  const body = editingDraft.value
  if (!node || node.kind !== 'text' || !body) return undefined
  return {
    body,
    bounds: node.bounds,
    transform: { originX: 0, originY: 0, scale: EMU_TO_CSS_PIXEL * props.zoom },
    active: true,
    selectionFrame: 'none' as const,
    ...(props.bridgeFactory ? { bridgeFactory: props.bridgeFactory } : {}),
  }
})

function overlayBounds(): ScreenBounds | undefined {
  const preview = resizePreview.value
  if (!preview || !sameIds(preview.elementIds, selectedElementIds.value)) return selectedBounds()
  return preview.bounds
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((elementId, index) => elementId === right[index])
}

function toDocumentBounds(bounds: ScreenBounds): Rect {
  const scale = EMU_TO_CSS_PIXEL * props.zoom
  return { x: bounds.x / scale, y: bounds.y / scale, w: bounds.w / scale, h: bounds.h / scale }
}

function snapGuideKey(guide: SnapGuide): string {
  return [guide.axis, guide.position, guide.source, guide.elementId ?? ''].join(':')
}

function snapGuideStyle(guide: SnapGuide): Record<string, string> {
  const position = String(guide.position * EMU_TO_CSS_PIXEL * props.zoom) + 'px'
  return guide.axis === 'x'
    ? { left: position, top: '0px', width: '1px', height: '100%' }
    : { left: '0px', top: position, width: '100%', height: '1px' }
}

function clearResizeGesture(): void {
  resizePreview.value = undefined
  resizeGesture.value = undefined
}

function resizePreviewFor(gesture: NonNullable<typeof resizeGesture.value>, payload: ResizePointerPayload): { bounds: ScreenBounds; guides: SnapGuide[] } {
  const proposedBounds = toDocumentBounds(resizeGestureBounds(gesture, payload.point, payload.shiftKey))
  const snapped = snapResizeBounds({
    scene: props.scene!,
    selectedElementIds: gesture.elementIds,
    sourceBounds: gesture.startDocumentBounds,
    proposedBounds,
    handle: gesture.handle,
    ...(props.snapOptions ? { options: props.snapOptions } : {}),
    aspectRatioLocked: payload.shiftKey,
  })
  return { bounds: toScreenBounds(snapped.bounds), guides: snapped.guides }
}

function resizeStart(payload: ResizePointerPayload): void {
  const elementIds = [...selectedElementIds.value]
  const bounds = selectedBounds()
  const documentBounds = selectedDocumentBounds()
  if (!bounds || !documentBounds || elementIds.length === 0 || !props.scene) return
  resizeGesture.value = {
    elementIds,
    handle: payload.handle,
    startBounds: bounds,
    startDocumentBounds: documentBounds,
    startPoint: payload.point,
    shiftKey: payload.shiftKey,
  }
  resizePreview.value = { elementIds, bounds, guides: [] }
}

function resizePreviewMove(payload: ResizePointerPayload): void {
  const gesture = resizeGesture.value
  if (!gesture || !sameIds(gesture.elementIds, selectedElementIds.value) || gesture.handle !== payload.handle) {
    if (gesture) clearResizeGesture()
    return
  }
  const preview = resizePreviewFor(gesture, payload)
  resizePreview.value = { elementIds: gesture.elementIds, ...preview }
}

function resizeEnd(payload: ResizePointerPayload): void {
  const gesture = resizeGesture.value
  if (!gesture || !sameIds(gesture.elementIds, selectedElementIds.value) || gesture.handle !== payload.handle) {
    clearResizeGesture()
    return
  }
  const next = resizePreviewFor(gesture, payload)
  const bounds = toDocumentBounds(next.bounds)
  if (gesture.elementIds.length === 1) {
    emit('resize', { elementId: gesture.elementIds[0]!, bounds })
  } else {
    emit('resize-selection', { elementIds: [...gesture.elementIds], bounds })
  }
  clearResizeGesture()
}

function resizeCancel(): void {
  clearResizeGesture()
}

function resizeGestureBounds(gesture: NonNullable<typeof resizeGesture.value>, point: Point, shiftKey: boolean): ScreenBounds {
  const handle = createSelectionOverlay(gesture.startBounds).handles.find((entry) => entry.name === gesture.handle)
  if (!handle) return gesture.startBounds
  const handlePoint = {
    x: handle.rect.x + handle.rect.w / 2 + point.x - gesture.startPoint.x,
    y: handle.rect.y + handle.rect.h / 2 + point.y - gesture.startPoint.y,
  }
  return shiftKey
    ? resizeBoundsWithAspectRatio(gesture.startBounds, gesture.handle, handlePoint)
    : resizeBounds(gesture.startBounds, gesture.handle, handlePoint)
}

const canvasProps = computed(() => ({
  scene: props.scene!,
  adapter: props.adapter!,
  ...(props.decoder ? { decoder: props.decoder } : {}),
  zoom: props.zoom,
  ...(props.devicePixelRatio === undefined ? {} : { devicePixelRatio: props.devicePixelRatio }),
  groupPath: groupPath.value,
}))

watch(() => props.scene, () => {
  normalizeGroupPath()
  if (resizeGesture.value) clearResizeGesture()
}, { immediate: true })
watch(selectedElementIds, (next) => {
  if (resizeGesture.value && !sameIds(resizeGesture.value.elementIds, next)) clearResizeGesture()
}, { deep: true })
onBeforeUnmount(clearResizeGesture)
</script>

<template>
  <section class="ppt-editor" aria-labelledby="ppt-editor-toolbar" tabindex="0" @keydown.capture="handleEditorKeyDown">
    <header id="ppt-editor-toolbar" class="ppt-editor__toolbar flex items-center gap-2 border-b border-slate-200 bg-white p-2">
      <button type="button" class="ppt-editor__button">
        {{ t('toolbar.insert.shape') }}
      </button>
      <div class="flex items-center gap-1" data-object-toolbar>
        <button
          type="button"
          class="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors duration-150 hover:border-slate-400 hover:bg-slate-50 active:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
          data-group-button
          :aria-label="t('toolbar.object.group')"
          :disabled="!canGroup"
          @click="emit('group')"
        >
          {{ t('toolbar.object.group') }}
        </button>
        <button
          type="button"
          class="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors duration-150 hover:border-slate-400 hover:bg-slate-50 active:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
          data-ungroup-button
          :aria-label="t('toolbar.object.ungroup')"
          :disabled="!canUngroup"
          @click="ungroupSelected"
        >
          {{ t('toolbar.object.ungroup') }}
        </button>
      </div>
    </header>
    <div class="ppt-editor__canvas relative" role="img" :aria-label="t('editor.canvas.ariaLabel')">
      <template v-if="props.scene && props.adapter">
        <SlideCanvas
          v-bind="canvasProps"
          @select="select"
          @render="emit('render', $event)"
          @move-start="emit('move-start', $event)"
          @move="move"
          @move-end="moveEnd"
          @enter-group="enterGroup"
          @activate="activate"
        />
        <div
          v-for="guide in resizePreview?.guides ?? []"
          :key="snapGuideKey(guide)"
          class="pointer-events-none absolute bg-blue-400"
          data-snap-guide
          :data-snap-axis="guide.axis"
          :style="snapGuideStyle(guide)"
        />
        <SelectionOverlay
          v-if="overlayBounds()"
          active
          :bounds="overlayBounds()!"
          :show-handles="selectedElementIds.length > 0"
          @resize-start="resizeStart"
          @resize="resizePreviewMove"
          @resize-end="resizeEnd"
          @resize-cancel="resizeCancel"
        />
        <div
          v-if="textEditorProps"
          class="pointer-events-none absolute inset-0"
          data-text-element-editor
          @keydown.capture="handleTextKeyDown"
          @focusout="handleTextFocusOut"
        >
          <TextBoxEditor
            v-bind="textEditorProps"
            @update:body="updateEditingDraft"
            @update:composing="updateEditingComposing"
          />
        </div>
      </template>
      <slot v-else />
    </div>
  </section>
</template>

<script setup lang="ts">
import type { SnapGuide, SnapOptions } from '@ppt4ai/engine'
import { rotatePointAround } from '@ppt4ai/geometry'
import type { AssetAdapter, Fill, Rect, StrokeStyle, TextBody } from '@ppt4ai/model'
import type { SceneGraph, SceneImageNode, SceneTableNode } from '@ppt4ai/render'
import type { ShapePaintToolbarProps } from './shape-paint-toolbar'
import type { TableCellPoint, TableCellSelection } from './table-editor-overlay'
import type { TableBorderPatch } from './table-editor-controller'
import type { TableFormattingToolbarProps } from './table-formatting-toolbar'
import type { ImeInputBridge, ImeInputBridgeOptions } from '@ppt4ai/text'
import { computed, onBeforeUnmount, ref, shallowRef, toRaw, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ShapePaintToolbar from './ShapePaintToolbar.vue'
import TableEditorOverlay from './TableEditorOverlay.vue'
import TableFormattingToolbar from './TableFormattingToolbar.vue'
import SlideCanvas from './SlideCanvas.vue'
import SelectionOverlay from './SelectionOverlay.vue'
import TextBoxEditor from './TextBoxEditor.vue'
import { rotationFromPointer, type ImageFlipAxis } from './image-transform'
import type { ImageDecoder } from './image-canvas-renderer'
import { createSelectionOverlay, resizeBounds, resizeBoundsWithAspectRatio, type Point, type ResizePointerPayload, type RotatePointerPayload, type SelectionHandle } from './selection-overlay'
import type { CanvasSelectionIntent } from './slide-canvas'
import { snapResizeBounds } from './resize-snapping'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  scene?: SceneGraph
  adapter?: AssetAdapter
  decoder?: ImageDecoder
  selectedElementId?: string
  selectedElementIds?: string[]
  /** The engine's authoritative cell selection, so the table toolbar reflects it rather than guessing. */
  tableCellSelection?: { elementId: string; row: number; column: number }
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
  'rotate-image': [payload: { elementId: string; rotation: number }]
  'rotate-element': [payload: { elementId: string; rotation: number }]
  'rotate-selection': [payload: { rotation: number }]
  'flip-image': [payload: { elementId: string; axis: ImageFlipAxis }]
  'flip-element': [payload: { elementId: string; axis: ImageFlipAxis }]
  'flip-selection': [payload: { axis: ImageFlipAxis }]
  'text-edit': [payload: { elementId: string; body: TextBody }]
  group: []
  ungroup: [payload: { groupId: string }]
  'set-fill': [fill: Fill | null]
  'set-stroke': [stroke: Fill | null]
  'set-stroke-width': [width: number | null]
  'set-stroke-style': [style: StrokeStyle | null]
  'select-table-cell': [payload: { elementId: string; selection: TableCellSelection }]
  'edit-table-cell': [payload: { elementId: string; point: TableCellPoint }]
  'set-table-cell-fill': [fill: Fill | null]
  'set-table-cell-borders': [borders: TableBorderPatch]
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

/**
 * Paint state comes from the scene node, which already merged the element's own value, the theme
 * style reference and the per-property width and dash fallback. Reading the element instead would
 * show a default for every shape whose colour arrives through `fillRef`.
 *
 * The editor stays presentational: it computes what to show and emits intents, and the host turns
 * those into commands, exactly as it already does for resize and rotation.
 */
const shapePaint = computed<ShapePaintToolbarProps>(() => {
  const elementIds = selectedElementIds.value
  const node = elementIds.length === 1
    ? props.scene?.nodes.find((entry) => entry.id === elementIds[0])
    : undefined
  if (node?.kind !== 'shape' && node?.kind !== 'text') {
    return { active: false, fillIsGradient: false, strokeIsGradient: false }
  }
  return {
    active: true,
    fillColor: node.resolvedFillColor ? `#${node.resolvedFillColor.rgb.toUpperCase()}` : '#FFFFFF',
    fillIsGradient: node.resolvedFillGradient !== undefined,
    strokeColor: node.resolvedStrokeColor ? `#${node.resolvedStrokeColor.rgb.toUpperCase()}` : '#000000',
    strokeIsGradient: node.resolvedStrokeGradient !== undefined,
    ...(node.strokeWidth === undefined ? {} : { strokeWidth: node.strokeWidth }),
    ...(node.strokeStyle === undefined ? {} : { strokeStyle: node.strokeStyle }),
  }
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
const selectedImageNode = computed<SceneImageNode | undefined>(() => {
  if (selectedElementIds.value.length !== 1) return undefined
  const node = props.scene?.nodes.find((entry) => entry.id === selectedElementIds.value[0])
  return node?.kind === 'image' ? node : undefined
})
const selectedRotatableNode = computed(() => {
  if (selectedElementIds.value.length !== 1) return undefined
  const elementId = selectedElementIds.value[0]!
  const group = props.scene?.groups?.find((entry) => entry.id === elementId)
  if (group) return { id: group.id, bounds: group.bounds, rotation: group.rotation }
  const node = props.scene?.nodes.find((entry) => entry.id === elementId)
  if (!node) return undefined
  if (node.kind !== 'image' && node.kind !== 'shape' && node.kind !== 'text' && node.kind !== 'table') return undefined
  return { id: node.id, bounds: node.bounds, rotation: node.transform?.rotation, kind: node.kind }
})
/** A multi-selection rotates as a unit about its union centre, so no single node owns the angle. */
const rotatesAsSelection = computed(() => selectedElementIds.value.length > 1 && Boolean(selectedBounds()))
const rotationHandleVisible = computed(() => Boolean(selectedRotatableNode.value) || rotatesAsSelection.value)
const transformEnabled = computed(() => Boolean(selectedRotatableNode.value) || rotatesAsSelection.value)

function ungroupSelected(): void {
  if (selectedGroupId.value) emit('ungroup', { groupId: selectedGroupId.value })
}

/**
 * The rotation gesture already covers a multi-selection, but the toolbar buttons did not. Both
 * transforms now share one gate, so a selection that can be dragged can also be clicked.
 */
function rotateSelectedNode(delta: number): void {
  const node = selectedRotatableNode.value
  if (!node) {
    // rotateSelection takes the delta applied to every member, not one element's absolute angle.
    if (rotatesAsSelection.value) emit('rotate-selection', { rotation: delta })
    return
  }
  const rotation = (node.rotation ?? 0) + delta
  if (node.kind === 'image') emit('rotate-image', { elementId: node.id, rotation })
  else emit('rotate-element', { elementId: node.id, rotation })
}

function flipSelectedNode(axis: ImageFlipAxis): void {
  const node = selectedRotatableNode.value
  if (!node) {
    if (rotatesAsSelection.value) emit('flip-selection', { axis })
    return
  }
  if (node.kind === 'image') emit('flip-image', { elementId: node.id, axis })
  else emit('flip-element', { elementId: node.id, axis })
}

const resizePreview = ref<{ elementIds: string[]; bounds: ScreenBounds; guides: SnapGuide[] }>()
const resizeGesture = ref<{
  elementIds: string[]
  handle: SelectionHandle
  startBounds: ScreenBounds
  startDocumentBounds: Rect
  startPoint: Point
  shiftKey: boolean
  rotation: number
  center: Point
}>()
const rotationPreview = ref<{ elementId?: string; rotation: number }>()
const rotationGesture = ref<{
  /** Undefined while rotating a multi-selection, which turns as a unit about the union centre. */
  elementId?: string
  startRotation: number
  center: Point
  startPoint: Point
  shiftKey: boolean
}>()
const editingElementId = ref<string>()
const editingDraft = shallowRef<TextBody>()
const editingComposing = ref(false)
const canvasElement = ref<HTMLElement>()
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

/**
 * The table cell overlay only appears for a single selected table. It owns its own cell selection
 * and reports it upward; the host turns that into `selectTableCell` so the engine holds the truth.
 */
const selectedTableNode = computed<SceneTableNode | undefined>(() => {
  const elementIds = selectedElementIds.value
  const node = elementIds.length === 1
    ? props.scene?.nodes.find((entry) => entry.id === elementIds[0])
    : undefined
  return node?.kind === 'table' ? node : undefined
})

/**
 * Reflects the engine's cell selection, not the overlay's own visual one: the commands act on what
 * the engine holds. The border row shows whichever side the cell defines first — the toolbar applies
 * to the sides the user ticks, so there is no single "current" side to display.
 */
const tableFormatting = computed<TableFormattingToolbarProps>(() => {
  const selection = props.tableCellSelection
  const node = selectedTableNode.value
  const cell = selection && node && selection.elementId === node.id
    ? node.layout.cells.find((entry) => entry.row === selection.row && entry.column === selection.column)
    : undefined
  if (!cell) {
    return { active: false, borderWidth: 12700, borderStyle: 'solid', borderSides: [] }
  }
  const side = (['left', 'right', 'top', 'bottom'] as const).find((entry) => cell.resolvedStyle.borders[entry])
  const border = side ? cell.resolvedStyle.borders[side] : undefined
  const borderColor = side ? cell.resolvedBorderColors?.[side] : undefined
  return {
    active: true,
    ...(cell.resolvedFillColor ? { fillColor: `#${cell.resolvedFillColor.rgb.toUpperCase()}` } : {}),
    ...(borderColor ? { borderColor: `#${borderColor.rgb.toUpperCase()}` } : {}),
    borderWidth: border?.width ?? 12700,
    borderStyle: border?.style === 'dash' || border?.style === 'dot' ? border.style : 'solid',
    borderSides: [],
  }
})

const tableOverlayTransform = computed(() => ({ originX: 0, originY: 0, scale: EMU_TO_CSS_PIXEL * props.zoom }))

function selectTableCell(selection: TableCellSelection): void {
  const node = selectedTableNode.value
  if (node) emit('select-table-cell', { elementId: node.id, selection })
}

function editTableCell(point: TableCellPoint): void {
  const node = selectedTableNode.value
  if (node) emit('edit-table-cell', { elementId: node.id, point })
}

function overlayBounds(): ScreenBounds | undefined {
  const preview = resizePreview.value
  if (!preview || !sameIds(preview.elementIds, selectedElementIds.value)) return selectedBounds()
  return preview.bounds
}

function overlayRotation(): number {
  const preview = rotationPreview.value
  const node = selectedRotatableNode.value
  if (!node) return preview && preview.elementId === undefined ? preview.rotation : 0
  return preview?.elementId === node.id ? preview.rotation : node.rotation ?? 0
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((elementId, index) => elementId === right[index])
}

function toDocumentBounds(bounds: ScreenBounds): Rect {
  const scale = EMU_TO_CSS_PIXEL * props.zoom
  return { x: bounds.x / scale, y: bounds.y / scale, w: bounds.w / scale, h: bounds.h / scale }
}

function toOverlayPoint(point: Point): Point {
  const rect = canvasElement.value?.getBoundingClientRect()
  return rect ? { x: point.x - rect.left, y: point.y - rect.top } : { ...point }
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

function clearRotationGesture(): void {
  rotationPreview.value = undefined
  rotationGesture.value = undefined
}

function resizePreviewFor(gesture: NonNullable<typeof resizeGesture.value>, payload: ResizePointerPayload): { bounds: ScreenBounds; guides: SnapGuide[] } {
  const proposedBounds = toDocumentBounds(resizeGestureBounds(gesture, payload))
  const snapped = snapResizeBounds({
    scene: props.scene!,
    selectedElementIds: gesture.elementIds,
    sourceBounds: gesture.startDocumentBounds,
    proposedBounds,
    handle: gesture.handle,
    ...(props.snapOptions ? { options: props.snapOptions } : {}),
    aspectRatioLocked: payload.shiftKey,
    centered: payload.altKey,
  })
  return { bounds: toScreenBounds(snapped.bounds), guides: snapped.guides }
}

function resizeStart(payload: ResizePointerPayload): void {
  const elementIds = [...selectedElementIds.value]
  const bounds = selectedBounds()
  const documentBounds = selectedDocumentBounds()
  if (!bounds || !documentBounds || elementIds.length === 0 || !props.scene) return
  const image = selectedImageNode.value
  resizeGesture.value = {
    elementIds,
    handle: payload.handle,
    startBounds: bounds,
    startDocumentBounds: documentBounds,
    startPoint: payload.point,
    shiftKey: payload.shiftKey,
    rotation: image && image.id === elementIds[0] ? image.transform?.rotation ?? 0 : 0,
    center: { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 },
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

function resizeGestureBounds(gesture: NonNullable<typeof resizeGesture.value>, payload: ResizePointerPayload): ScreenBounds {
  const handle = createSelectionOverlay(gesture.startBounds).handles.find((entry) => entry.name === gesture.handle)
  if (!handle) return gesture.startBounds
  const localStart = rotatePointAround(toOverlayPoint(gesture.startPoint), gesture.center, -gesture.rotation)
  const localCurrent = rotatePointAround(toOverlayPoint(payload.point), gesture.center, -gesture.rotation)
  const handlePoint = {
    x: handle.rect.x + handle.rect.w / 2 + localCurrent.x - localStart.x,
    y: handle.rect.y + handle.rect.h / 2 + localCurrent.y - localStart.y,
  }
  const options = { center: payload.altKey }
  return payload.shiftKey
    ? resizeBoundsWithAspectRatio(gesture.startBounds, gesture.handle, handlePoint, options)
    : resizeBounds(gesture.startBounds, gesture.handle, handlePoint, options)
}

function rotationStart(payload: RotatePointerPayload): void {
  const node = selectedRotatableNode.value
  const bounds = node ? toScreenBounds(node.bounds) : selectedBounds()
  if (!bounds) return
  // A multi-selection starts from zero: the delta is what gets applied to every member.
  const startRotation = node ? node.rotation ?? 0 : 0
  rotationGesture.value = {
    ...(node ? { elementId: node.id } : {}),
    startRotation,
    center: { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 },
    startPoint: toOverlayPoint(payload.point),
    shiftKey: payload.shiftKey,
  }
  rotationPreview.value = { ...(node ? { elementId: node.id } : {}), rotation: startRotation }
}

function currentRotation(gesture: NonNullable<typeof rotationGesture.value>, payload: RotatePointerPayload): number {
  return rotationFromPointer(
    gesture.startRotation,
    gesture.center,
    gesture.startPoint,
    toOverlayPoint(payload.point),
    payload.shiftKey,
  )
}

/** The gesture is stale once the selection it started on is gone. */
function rotationGestureMatchesSelection(gesture: NonNullable<typeof rotationGesture.value>): boolean {
  if (gesture.elementId === undefined) return rotatesAsSelection.value
  return selectedRotatableNode.value?.id === gesture.elementId
}

function rotationMove(payload: RotatePointerPayload): void {
  const gesture = rotationGesture.value
  if (!gesture || !rotationGestureMatchesSelection(gesture)) {
    if (gesture) clearRotationGesture()
    return
  }
  gesture.shiftKey = payload.shiftKey
  rotationPreview.value = {
    ...(gesture.elementId === undefined ? {} : { elementId: gesture.elementId }),
    rotation: currentRotation(gesture, payload),
  }
}

function rotationEnd(payload: RotatePointerPayload): void {
  const gesture = rotationGesture.value
  if (!gesture || !rotationGestureMatchesSelection(gesture)) {
    clearRotationGesture()
    return
  }
  const rotation = currentRotation(gesture, payload)
  if (gesture.elementId === undefined) {
    emit('rotate-selection', { rotation })
  } else if (selectedRotatableNode.value?.kind === 'image') {
    emit('rotate-image', { elementId: gesture.elementId, rotation })
  } else {
    emit('rotate-element', { elementId: gesture.elementId, rotation })
  }
  clearRotationGesture()
}

function rotationCancel(): void {
  clearRotationGesture()
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
  if (rotationGesture.value) clearRotationGesture()
}, { immediate: true })
watch(selectedElementIds, (next) => {
  if (resizeGesture.value && !sameIds(resizeGesture.value.elementIds, next)) clearResizeGesture()
  if (rotationGesture.value && selectedImageNode.value?.id !== rotationGesture.value.elementId) clearRotationGesture()
}, { deep: true })
watch(() => props.zoom, () => {
  if (resizeGesture.value) clearResizeGesture()
  if (rotationGesture.value) clearRotationGesture()
})
watch(groupPath, () => {
  if (resizeGesture.value) clearResizeGesture()
  if (rotationGesture.value) clearRotationGesture()
}, { deep: true })
onBeforeUnmount(() => {
  clearResizeGesture()
  clearRotationGesture()
})
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
        <template v-if="transformEnabled">
          <button
            type="button"
            class="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors duration-150 hover:border-slate-400 hover:bg-slate-50 active:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            data-image-transform-button="rotate-left"
            :aria-label="t('toolbar.object.rotateLeft')"
            @click="rotateSelectedNode(-5400000)"
          >
            {{ t('toolbar.object.rotateLeft') }}
          </button>
          <button
            type="button"
            class="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors duration-150 hover:border-slate-400 hover:bg-slate-50 active:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            data-image-transform-button="rotate-right"
            :aria-label="t('toolbar.object.rotateRight')"
            @click="rotateSelectedNode(5400000)"
          >
            {{ t('toolbar.object.rotateRight') }}
          </button>
          <button
            type="button"
            class="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors duration-150 hover:border-slate-400 hover:bg-slate-50 active:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            data-image-transform-button="flip-horizontal"
            :aria-label="t('toolbar.object.flipHorizontal')"
            @click="flipSelectedNode('horizontal')"
          >
            {{ t('toolbar.object.flipHorizontal') }}
          </button>
          <button
            type="button"
            class="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors duration-150 hover:border-slate-400 hover:bg-slate-50 active:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            data-image-transform-button="flip-vertical"
            :aria-label="t('toolbar.object.flipVertical')"
            @click="flipSelectedNode('vertical')"
          >
            {{ t('toolbar.object.flipVertical') }}
          </button>
        </template>
      </div>
      <TableFormattingToolbar
        v-if="selectedTableNode"
        v-bind="tableFormatting"
        @set-fill="emit('set-table-cell-fill', $event)"
        @set-borders="emit('set-table-cell-borders', $event)"
      />
      <ShapePaintToolbar
        v-bind="shapePaint"
        @set-fill="emit('set-fill', $event)"
        @set-stroke="emit('set-stroke', $event)"
        @set-stroke-width="emit('set-stroke-width', $event)"
        @set-stroke-style="emit('set-stroke-style', $event)"
      />
    </header>
    <div ref="canvasElement" class="ppt-editor__canvas relative" role="img" :aria-label="t('editor.canvas.ariaLabel')">
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
          :rotation="overlayRotation()"
          :show-rotation-handle="rotationHandleVisible"
          @resize-start="resizeStart"
          @resize="resizePreviewMove"
          @resize-end="resizeEnd"
          @resize-cancel="resizeCancel"
          @rotate-start="rotationStart"
          @rotate="rotationMove"
          @rotate-end="rotationEnd"
          @rotate-cancel="rotationCancel"
        />
        <TableEditorOverlay
          v-if="selectedTableNode"
          active
          :table="selectedTableNode"
          :transform="tableOverlayTransform"
          @select="selectTableCell"
          @select-end="selectTableCell"
          @edit="editTableCell"
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

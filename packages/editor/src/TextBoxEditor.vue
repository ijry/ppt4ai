<script setup lang="ts">
import type { TextBody } from '@ppt4ai/model'
import {
  createTextEditorState,
  getTextEditorSnapshot,
  layoutText,
  mapTextSelection,
  replaceText,
  setTextEditorSelection,
  textBodyToProseMirror,
  type ScreenRect,
  type TextEditorSelection,
  type TextEditorSnapshot,
  type TextFormattingState,
  type TextMarkName,
  type TextMarksPatch,
} from '@ppt4ai/text'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import SelectionOverlay from './SelectionOverlay.vue'
import TextEditorOverlay from './TextEditorOverlay.vue'
import { createTextEditorController, type TextEditorController } from './text-editor-controller'
import { createTextInteraction, layoutRectToScreen, type TextViewportTransform, textPositionAtScreenPoint } from './text-editor-interaction'
import type { TextBoxEditorProps, TextBoxEditorResizePayload } from './text-box-editor'

const props = defineProps<TextBoxEditorProps>()
const emit = defineEmits<{
  (event: 'update:body', body: TextBody): void
  (event: 'update:composing', composing: boolean): void
  (event: 'update:selection', selection: TextEditorSelection): void
  (event: 'update:formatting', state: TextFormattingState): void
  (event: 'resize-start', payload: TextBoxEditorResizePayload): void
  (event: 'resize', payload: TextBoxEditorResizePayload): void
  (event: 'resize-end', payload: TextBoxEditorResizePayload): void
}>()

const root = ref<HTMLElement>()
const controller = shallowRef<TextEditorController>()
const snapshot = shallowRef<TextEditorSnapshot>()
const dragAnchor = ref<number>()
const lastBody = ref(JSON.stringify(props.body))
const lastSelection = ref('')
let unsubscribe: (() => void) | undefined
let pointerListenersAttached = false

const interaction = computed(() => {
  if (!snapshot.value) return undefined
  let body = snapshot.value.body
  let selection = snapshot.value.selection
  let compositionRange: { from: number; to: number } | undefined

  if (snapshot.value.composing && snapshot.value.compositionText) {
    let previewState = createTextEditorState(body)
    previewState = setTextEditorSelection(previewState, selection)
    previewState = replaceText(previewState, snapshot.value.compositionText)
    const previewSnapshot = getTextEditorSnapshot(previewState)
    body = previewSnapshot.body
    selection = previewSnapshot.selection
    compositionRange = {
      from: Math.min(snapshot.value.selection.anchor, snapshot.value.selection.head),
      to: selection.head,
    }
  }

  const document = textBodyToProseMirror(body)
  const layout = layoutText({ bounds: props.bounds, body })
  const result = createTextInteraction(layout, document, selection, props.transform)
  const composition = compositionRange
    ? mapTextSelection(layout, document, compositionRange.from, compositionRange.to)
      .map((rect) => layoutRectToScreen(rect, props.transform))
    : []
  return { ...result, composition }
})

const surface = computed(() => layoutRectToScreen({
  x: props.bounds.x,
  y: props.bounds.y,
  width: props.bounds.w,
  height: props.bounds.h,
}, props.transform))

const selectionBounds = computed(() => ({
  x: surface.value.x,
  y: surface.value.y,
  w: surface.value.width,
  h: surface.value.height,
}))

function createController(): void {
  if (!props.active || controller.value || !root.value) return
  const nextController = createTextEditorController({
    host: root.value,
    body: props.body,
    ...(props.bridgeFactory ? { bridgeFactory: props.bridgeFactory } : {}),
  })
  controller.value = nextController
  snapshot.value = nextController.getSnapshot()
  emit('update:formatting', nextController.getFormattingState())
  lastBody.value = JSON.stringify(snapshot.value.body)
  lastSelection.value = selectionKey(snapshot.value.selection)
  unsubscribe = nextController.subscribe((nextSnapshot) => {
    const previousBody = lastBody.value
    const previousSelection = lastSelection.value
    const previousComposing = snapshot.value?.composing ?? false
    snapshot.value = nextSnapshot
    if (previousComposing !== nextSnapshot.composing) emit('update:composing', nextSnapshot.composing)
    emit('update:formatting', nextController.getFormattingState())
    lastBody.value = JSON.stringify(nextSnapshot.body)
    lastSelection.value = selectionKey(nextSnapshot.selection)
    if (previousSelection !== lastSelection.value) emit('update:selection', { ...nextSnapshot.selection })
    if (!nextSnapshot.composing && previousBody !== lastBody.value) emit('update:body', structuredClone(nextSnapshot.body))
  })
  if (props.selection) nextController.setSelection(props.selection)
  nextController.focus()
}

function destroyController(): void {
  detachPointerListeners()
  if (snapshot.value?.composing) emit('update:composing', false)
  unsubscribe?.()
  unsubscribe = undefined
  controller.value?.destroy()
  controller.value = undefined
  snapshot.value = undefined
  dragAnchor.value = undefined
}

function selectionKey(selection: TextEditorSelection): string {
  return `${selection.anchor}:${selection.head}`
}

function eventPoint(event: MouseEvent): { x: number; y: number } {
  return { x: event.clientX, y: event.clientY }
}

function setSelectionAt(event: MouseEvent, anchor: number): void {
  if (!controller.value || !snapshot.value) return
  const body = snapshot.value.body
  const document = textBodyToProseMirror(body)
  const layout = layoutText({ bounds: props.bounds, body })
  const head = textPositionAtScreenPoint(layout, document, eventPoint(event), props.transform)
  controller.value.setSelection({ anchor, head })
}

function handlePointerDown(event: PointerEvent): void {
  if (!controller.value || event.button !== 0) return
  const body = snapshot.value?.body ?? props.body
  const document = textBodyToProseMirror(body)
  const layout = layoutText({ bounds: props.bounds, body })
  const anchor = textPositionAtScreenPoint(layout, document, eventPoint(event), props.transform)
  dragAnchor.value = anchor
  controller.value.setSelection({ anchor, head: anchor })
  attachPointerListeners()
  event.preventDefault()
}

function handlePointerMove(event: PointerEvent): void {
  if (dragAnchor.value === undefined) return
  setSelectionAt(event, dragAnchor.value)
}

function handlePointerUp(event: PointerEvent): void {
  if (dragAnchor.value === undefined) return
  setSelectionAt(event, dragAnchor.value)
  dragAnchor.value = undefined
  detachPointerListeners()
}

function attachPointerListeners(): void {
  if (pointerListenersAttached) return
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)
  pointerListenersAttached = true
}

function detachPointerListeners(): void {
  if (!pointerListenersAttached) return
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', handlePointerUp)
  pointerListenersAttached = false
}

watch(() => props.active, (active) => {
  if (active) createController()
  else destroyController()
})

watch(interaction, (nextInteraction) => {
  if (nextInteraction && controller.value) controller.value.syncCaret(nextInteraction.caret)
}, { deep: true, immediate: true })

onMounted(createController)
/**
 * The formatting commands are exposed rather than taken as props: they are imperative actions on the
 * live editor selection, and a prop would have to encode "apply this once", which is what an
 * imperative call already says. The state travels the other way through `update:formatting`.
 */
defineExpose({
  setMarks: (patch: TextMarksPatch) => controller.value?.setMarks(patch),
  toggleMark: (name: TextMarkName) => controller.value?.toggleMark(name),
  setAlignment: (align: 'left' | 'center' | 'right') => controller.value?.setAlignment(align),
})

onBeforeUnmount(destroyController)
</script>

<template>
  <div
    ref="root"
    class="ppt-text-box-editor pointer-events-none absolute inset-0"
    data-text-box-editor
  >
    <div
      v-if="props.active && interaction"
      class="absolute pointer-events-auto bg-transparent"
      data-text-box-surface
      :style="{
        left: `${surface.x}px`,
        top: `${surface.y}px`,
        width: `${surface.width}px`,
        height: `${surface.height}px`,
      }"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
    />
    <TextEditorOverlay
      v-if="props.active && interaction"
      :active="true"
      :caret="interaction.caret"
      :selection="interaction.selection"
      :composition="interaction.composition"
    />
    <SelectionOverlay
      v-if="props.active && props.selectionFrame !== 'none'"
      :active="true"
      :bounds="selectionBounds"
      @resize-start="emit('resize-start', $event)"
      @resize="emit('resize', $event)"
      @resize-end="emit('resize-end', $event)"
    />
  </div>
</template>

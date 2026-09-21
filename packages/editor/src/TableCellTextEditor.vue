<script setup lang="ts">
import type { TextBody } from '@ppt4ai/model'
import { computed, shallowRef, toRaw, ref, watch } from 'vue'
import TextBoxEditor from './TextBoxEditor.vue'
import type { TableCellTextEditorProps } from './table-cell-text-editor'

const props = defineProps<TableCellTextEditorProps>()
const emit = defineEmits<{
  (event: 'update:draft', body: TextBody): void
  (event: 'commit', body: TextBody): void
  (event: 'cancel'): void
}>()

function cloneBody(body: TextBody): TextBody {
  return structuredClone(toRaw(body))
}

const draft = shallowRef<TextBody>(cloneBody(props.cell.body))
const composing = ref(false)
let closed = !props.active
let pendingClose: 'commit' | 'cancel' | undefined
let closeScheduled = false

const textEditorProps = computed(() => ({
  body: draft.value,
  bounds: props.cell.bounds,
  transform: props.transform,
  active: props.active && !closed,
  selectionFrame: 'none' as const,
  ...(props.bridgeFactory ? { bridgeFactory: props.bridgeFactory } : {}),
}))

function updateDraft(body: TextBody): void {
  if (closed) return
  draft.value = cloneBody(body)
  emit('update:draft', cloneBody(draft.value))
}

function close(action: 'commit' | 'cancel'): void {
  if (closed) return
  closed = true
  pendingClose = undefined
  if (action === 'commit') emit('commit', cloneBody(draft.value))
  else emit('cancel')
}

function scheduleClose(action: 'commit' | 'cancel'): void {
  if (closed) return
  pendingClose = action
  if (composing.value || closeScheduled) return
  closeScheduled = true
  queueMicrotask(() => {
    closeScheduled = false
    const requested = pendingClose
    if (requested && !composing.value) close(requested)
  })
}

function updateComposing(value: boolean): void {
  composing.value = value
  if (!value && pendingClose) scheduleClose(pendingClose)
}

function handleKeyDown(event: KeyboardEvent): void {
  const action = event.key === 'Escape'
    ? 'cancel'
    : event.key === 'Enter' && event.ctrlKey
      ? 'commit'
      : undefined
  if (!action) return
  event.preventDefault()
  event.stopPropagation()
  if (composing.value) scheduleClose(action)
  else close(action)
}

function handleFocusOut(event: FocusEvent): void {
  const nextTarget = event.relatedTarget
  if (nextTarget instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
  scheduleClose('commit')
}

watch(
  () => [props.active, props.cell.row, props.cell.column] as const,
  ([active]) => {
    if (!active) {
      closed = true
      pendingClose = undefined
      return
    }
    draft.value = cloneBody(props.cell.body)
    composing.value = false
    closed = false
    pendingClose = undefined
  },
)
</script>

<template>
  <div
    class="ppt-table-cell-text-editor pointer-events-none absolute inset-0"
    data-table-cell-text-editor
    @keydown.capture="handleKeyDown"
    @focusout="handleFocusOut"
  >
    <TextBoxEditor
      v-bind="textEditorProps"
      @update:body="updateDraft"
      @update:composing="updateComposing"
    />
  </div>
</template>

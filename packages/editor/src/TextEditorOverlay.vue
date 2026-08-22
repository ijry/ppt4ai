<script setup lang="ts">
import type { ScreenRect } from '@ppt4ai/text'

const props = defineProps<{
  active: boolean
  caret: ScreenRect
  selection: ScreenRect[]
  composition?: ScreenRect[]
}>()

function rectStyle(rect: ScreenRect): Record<string, string> {
  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  }
}
</script>

<template>
  <div
    v-if="props.active"
    class="ppt-text-editor-overlay pointer-events-none absolute inset-0"
    data-text-editor-overlay
    aria-hidden="true"
  >
    <div
      v-for="(rect, index) in props.selection"
      :key="index"
      class="absolute bg-blue-400/35"
      data-text-selection
      :style="rectStyle(rect)"
    />
    <div
      v-for="(rect, index) in props.composition ?? []"
      :key="`composition-${index}`"
      class="absolute border-b-2 border-blue-700"
      data-text-composition
      :style="rectStyle(rect)"
    />
    <div
      class="absolute bg-blue-700"
      data-text-caret
      :style="rectStyle(props.caret)"
    />
  </div>
</template>

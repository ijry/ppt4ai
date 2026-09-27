<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const open = ref(false)
const root = ref<HTMLElement>()
function toggle(): void { open.value = !open.value }
function close(): void { open.value = false }
function onPointerDown(event: PointerEvent): void {
  if (open.value && root.value && !root.value.contains(event.target as Node)) close()
}
function onKey(event: KeyboardEvent): void { if (event.key === 'Escape') close() }
onMounted(() => { document.addEventListener('pointerdown', onPointerDown); document.addEventListener('keydown', onKey) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKey) })
</script>
<template>
  <div ref="root" class="relative inline-flex">
    <slot name="trigger" :toggle="toggle" :open="open" />
    <div v-if="open" class="absolute left-0 top-full z-50 mt-1 rounded-lg border border-border bg-surface p-2 shadow-pop" data-popover>
      <slot :close="close" />
    </div>
  </div>
</template>

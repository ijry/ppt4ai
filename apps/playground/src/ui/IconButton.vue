<script setup lang="ts">
const props = defineProps<{ label: string; disabled?: boolean; active?: boolean }>()
defineEmits<{ click: [] }>()
</script>
<template>
  <button type="button" class="icon-btn" :aria-label="props.label" :aria-pressed="props.active ? 'true' : 'false'" :disabled="props.disabled" @click="$emit('click')">
    <slot />
  </button>
</template>

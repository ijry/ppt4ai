<script setup lang="ts">
const props = withDefaults(defineProps<{ variant?: 'default' | 'primary' | 'danger' | 'ghost'; disabled?: boolean }>(), { variant: 'default' })
defineEmits<{ click: [] }>()
const cls = { default: 'btn', primary: 'btn-primary', danger: 'btn-danger', ghost: 'btn-ghost' }
</script>
<template>
  <button type="button" :class="cls[props.variant]" :disabled="props.disabled" @click="$emit('click')">
    <slot />
  </button>
</template>

<script setup lang="ts">
defineProps<{ label: string }>()
</script>
<template>
  <label class="field justify-between py-1">
    <span class="text-muted">{{ label }}</span>
    <span class="flex items-center gap-1"><slot /></span>
  </label>
</template>

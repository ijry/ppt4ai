<script setup lang="ts">
defineProps<{ title?: string }>()
</script>
<template>
  <div class="border-t border-border py-3 first:border-t-0">
    <h3 v-if="title" class="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{{ title }}</h3>
    <slot />
  </div>
</template>

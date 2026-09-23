<script setup lang="ts">
defineProps<{ title?: string }>()
</script>
<template>
  <section class="panel overflow-hidden">
    <h2 v-if="title" class="panel-title border-b border-border">{{ title }}</h2>
    <div class="p-4"><slot /></div>
  </section>
</template>

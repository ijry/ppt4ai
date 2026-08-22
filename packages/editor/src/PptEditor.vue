<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <section class="ppt-editor" aria-labelledby="ppt-editor-toolbar">
    <header id="ppt-editor-toolbar" class="ppt-editor__toolbar">
      <button type="button" class="ppt-editor__button">
        {{ t('toolbar.insert.shape') }}
      </button>
    </header>
    <div class="ppt-editor__canvas" role="img" :aria-label="t('editor.canvas.ariaLabel')">
      <slot />
    </div>
  </section>
</template>

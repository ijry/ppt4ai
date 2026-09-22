import { defineConfig, presetUno } from 'unocss'

export default defineConfig({
  presets: [presetUno()],
  // The editor package styles itself with utility classes but ships no CSS — the consuming app generates
  // it. Without scanning the editor's source, none of its toolbar/panel/button classes produce any CSS
  // and the whole editor renders unstyled. Globs are resolved from this package dir (apps/playground).
  content: {
    filesystem: [
      '../../packages/editor/src/**/*.{vue,ts}',
    ],
  },
})

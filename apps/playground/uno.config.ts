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
  theme: {
    colors: {
      surface: '#ffffff', 'surface-2': '#f8fafc', bg: '#f1f5f9',
      border: '#e2e8f0', text: '#0f172a', muted: '#64748b',
      primary: '#2563eb', 'primary-hover': '#1d4ed8', danger: '#dc2626',
    },
  },
  shortcuts: {
    btn: 'inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
    'btn-primary': 'btn border-primary bg-primary text-white hover:bg-primary-hover',
    'btn-danger': 'btn border-danger text-danger hover:bg-red-50',
    'btn-ghost': 'btn border-transparent bg-transparent',
    'icon-btn': 'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-40 aria-[pressed=true]:bg-surface-2 aria-[pressed=true]:text-primary',
    panel: 'rounded-lg border border-border bg-surface shadow-sm',
    'panel-title': 'px-3 py-2 text-sm font-semibold text-text',
    field: 'flex items-center gap-2 text-sm text-text',
  },
})

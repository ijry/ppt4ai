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
      // App surfaces — a soft, cool neutral ramp for a calm product canvas.
      bg: '#f4f5f7', surface: '#ffffff', 'surface-2': '#f1f3f5', 'surface-3': '#e9ecef',
      border: '#e6e8eb', 'border-strong': '#d5d9de',
      text: '#0b1524', muted: '#667085', faint: '#98a2b3',
      // Indigo accent reads more premium than plain blue.
      primary: '#4f46e5', 'primary-hover': '#4338ca', 'primary-soft': '#eef2ff',
      danger: '#e5484d', 'danger-soft': '#fef2f2',
    },
    boxShadow: {
      panel: '0 1px 2px rgba(11,21,36,.04), 0 1px 3px rgba(11,21,36,.06)',
      toolbar: '0 1px 0 rgba(11,21,36,.05), 0 1px 12px rgba(11,21,36,.03)',
      slide: '0 12px 34px rgba(11,21,36,.14), 0 2px 8px rgba(11,21,36,.08)',
      card: '0 1px 2px rgba(11,21,36,.05)',
      'card-hover': '0 6px 18px rgba(11,21,36,.12)',
      pop: '0 10px 30px rgba(11,21,36,.18)',
    },
  },
  shortcuts: {
    btn: 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 h-9 text-sm font-medium text-text shadow-card transition-all hover:bg-surface-2 hover:border-border-strong active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
    'btn-primary': 'btn border-transparent bg-primary text-white shadow-card hover:bg-primary-hover hover:border-transparent',
    'btn-danger': 'btn border-transparent bg-danger-soft text-danger hover:bg-danger/10',
    'btn-ghost': 'btn border-transparent bg-transparent shadow-none hover:bg-surface-2',
    'icon-btn': 'inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-all hover:bg-surface-2 hover:text-text active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent aria-[pressed=true]:bg-primary-soft aria-[pressed=true]:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
    panel: 'rounded-xl border border-border bg-surface shadow-panel',
    'panel-title': 'flex items-center px-4 h-11 text-sm font-semibold text-text',
    'section-label': 'px-1 text-xs font-semibold uppercase tracking-wider text-faint',
    field: 'flex items-center gap-2 text-sm text-text',
  },
})

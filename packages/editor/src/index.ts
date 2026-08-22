export { default as PptEditor } from './PptEditor.vue'
export { createPpt4aiI18n } from './i18n'
export { locales } from './i18n'
export type { EditorLocale } from './i18n'
export { createTextEditorController } from './text-editor-controller'
export type { TextEditorController, TextEditorControllerOptions } from './text-editor-controller'
export { default as SelectionOverlay } from './SelectionOverlay.vue'
export { createSelectionOverlay, resizeBounds } from './selection-overlay'
export type {
  Point,
  ResizeOptions,
  SelectionHandle,
  SelectionHandleRect,
  SelectionOverlayModel,
  SelectionOverlayOptions,
} from './selection-overlay'

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
export { default as TextEditorOverlay } from './TextEditorOverlay.vue'
export { default as TextBoxEditor } from './TextBoxEditor.vue'
export type { TextBoxEditorProps, TextBoxEditorResizePayload } from './text-box-editor'
export { default as TextFormattingToolbar } from './TextFormattingToolbar.vue'
export type { TextFormattingToolbarEmit, TextFormattingToolbarProps } from './text-formatting-toolbar'
export { default as TableEditorOverlay } from './TableEditorOverlay.vue'
export {
  createTableEditorOverlay,
  selectedTableCells,
  tableCellAtPoint,
} from './table-editor-overlay'
export type {
  TableCellPoint,
  TableCellSelection,
  TableEditorCell,
  TableEditorOverlayModel,
} from './table-editor-overlay'
export {
  createTextInteraction,
  layoutRectToScreen,
  screenPointToLayout,
  textPositionAtScreenPoint,
} from './text-editor-interaction'
export type { TextEditorInteraction, TextViewportTransform } from './text-editor-interaction'

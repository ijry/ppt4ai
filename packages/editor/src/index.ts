export { default as PptEditor } from './PptEditor.vue'
export { createPpt4aiI18n } from './i18n'
export { locales } from './i18n'
export type { EditorLocale } from './i18n'
export { createTextEditorController } from './text-editor-controller'
export type { TextEditorController, TextEditorControllerOptions } from './text-editor-controller'
export { default as SelectionOverlay } from './SelectionOverlay.vue'
export { createSelectionOverlay, resizeBounds, resizeBoundsWithAspectRatio } from './selection-overlay'
export { IMAGE_ROTATION_SNAP_STEP, rotationFromPointer } from './image-transform'
export type { ImageFlipAxis } from './image-transform'
export { snapResizeBounds } from './resize-snapping'
export type { ResizeSnapRequest, ResizeSnapResult } from './resize-snapping'
export type {
  Point,
  ResizeOptions,
  ResizePointerPayload,
  RotatePointerPayload,
  SelectionHandle,
  SelectionHandleRect,
  SelectionOverlayModel,
  SelectionOverlayOptions,
} from './selection-overlay'
export { default as TextEditorOverlay } from './TextEditorOverlay.vue'
export { default as TextBoxEditor } from './TextBoxEditor.vue'
export type { TextBoxEditorProps, TextBoxEditorResizePayload, TextBoxEditorSelectionFrame } from './text-box-editor'
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
export { createTableEditorController } from './table-editor-controller'
export type {
  TableBorderPatch,
  TableBorderSide,
  TableEditorController,
  TableEditorControllerOptions,
} from './table-editor-controller'
export { default as TableCellTextEditor } from './TableCellTextEditor.vue'
export type { TableCellTextEditorProps } from './table-cell-text-editor'
export { createTableCellTextEditingController } from './table-cell-text-editing-controller'
export type {
  TableCellTextEditingController,
  TableCellTextEditingControllerOptions,
} from './table-cell-text-editing-controller'
export { default as TableFormattingToolbar } from './TableFormattingToolbar.vue'
export type {
  TableFormattingToolbarEmit,
  TableFormattingToolbarProps,
} from './table-formatting-toolbar'
export {
  createTextInteraction,
  layoutRectToScreen,
  screenPointToLayout,
  textPositionAtScreenPoint,
} from './text-editor-interaction'
export type { TextEditorInteraction, TextViewportTransform } from './text-editor-interaction'
export { createImageCanvasRenderer } from './image-canvas-renderer'
export { createSlideCanvasRenderer } from './slide-canvas-renderer'
export { decodeBrowserImage } from './browser-image-decoder'
export { default as ImageCanvas } from './ImageCanvas.vue'
export type {
  DecodedImage,
  ImageCanvasRenderer,
  ImageCanvasRendererOptions,
  ImageDecoder,
  ImageRenderIssue,
  ImageRenderResult,
  ImageViewport,
} from './image-canvas-renderer'
export type {
  SlideCanvasRenderIssue,
  SlideCanvasRenderResult,
  SlideCanvasRenderer,
  SlideCanvasViewport,
} from './slide-canvas-renderer'
export { default as ThumbnailCanvas } from './ThumbnailCanvas.vue'
export { default as SlideCanvas } from './SlideCanvas.vue'
export { hitTestScene, pointFromCanvasEvent } from './slide-canvas'
export { createThumbnailRenderer, ThumbnailRendererError } from './thumbnail-renderer'
export type {
  ThumbnailRenderer,
  ThumbnailRendererOptions,
  ThumbnailWorkerFactory,
  ThumbnailWorkerPort,
} from './thumbnail-renderer'
export type {
  ThumbnailIssueCode,
  ThumbnailRenderResult,
  ThumbnailViewport,
} from './thumbnail-protocol'
export type { AssetAdapter, AssetMetadata } from '@ppt4ai/model'
export type { SceneGraph } from '@ppt4ai/render'
export { createImageAssetController, ImageAssetControllerError } from './image-asset-controller'
export type {
  ImageAssetController,
  ImageAssetControllerOptions,
  InsertImageAssetInput,
  ReplaceImageAssetInput,
} from './image-asset-controller'
export { default as AssetLibrary } from './AssetLibrary.vue'
export { createAssetLibraryModel } from './asset-library'
export type { AssetLibraryItem, AssetLibraryModel } from './asset-library'
export { default as ThemePanel } from './ThemePanel.vue'
export { colorFromHex, hexFromColor, THEME_FONT_ROWS, THEME_SLOT_GROUPS, themeFontModels, themeSlotGroup } from './theme-panel'
export type { ThemePanelEmit, ThemePanelFontModel, ThemePanelProps, ThemePanelSlotModel, ThemeSlotGroup } from './theme-panel'
export { createThemeEditorController } from './theme-editor-controller'
export type { ThemeEditorController, ThemeEditorControllerOptions } from './theme-editor-controller'
export { createShapePaintController } from './shape-paint-controller'
export type { ShapePaintController, ShapePaintControllerOptions } from './shape-paint-controller'
export { default as ShapePaintToolbar } from './ShapePaintToolbar.vue'
export { emuFromPoints, pointsFromEmu, STROKE_STYLE_OPTIONS } from './shape-paint-toolbar'
export type { ShapePaintToolbarEmit, ShapePaintToolbarProps } from './shape-paint-toolbar'

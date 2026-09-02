import { EditorEngine, type EngineState, type ImageFlipAxis, type SnapOptions } from '@ppt4ai/engine'
import { createImageAssetController, ImageAssetControllerError } from '@ppt4ai/editor'
import type { AssetAdapter, AssetMetadata, Color, Element, ImageElement, Ppt4aiDocument, Rect, TextBody, ThemeColorSlot } from '@ppt4ai/model'
import type { PlaygroundImageUploadInput } from './image-file-upload'

export interface PlaygroundAssetHostSnapshot {
  engineState: EngineState
  selectedAssetId?: string
  status: {
    kind: 'idle' | 'success' | 'error'
    message: string
  }
}

export interface PlaygroundAssetHost {
  adapter: AssetAdapter
  readonly snapOptions: SnapOptions
  getSnapshot(): PlaygroundAssetHostSnapshot
  undo(): PlaygroundAssetHostSnapshot
  redo(): PlaygroundAssetHostSnapshot
  insertElements(rootElementIds: string[], elements: Element[], assets: AssetMetadata[]): PlaygroundAssetHostSnapshot
  selectElements(elementIds: string[]): PlaygroundAssetHostSnapshot
  selectElement(elementId: string | undefined): PlaygroundAssetHostSnapshot
  moveSelected(elementId: string, dx: number, dy: number): PlaygroundAssetHostSnapshot
  groupSelected(): PlaygroundAssetHostSnapshot
  ungroupSelected(groupId: string): PlaygroundAssetHostSnapshot
  resizeSelected(elementIds: string[], bounds: Rect): PlaygroundAssetHostSnapshot
  resizeElement(elementId: string, bounds: Rect): PlaygroundAssetHostSnapshot
  rotateSelectedImage(elementId: string, rotation: number): PlaygroundAssetHostSnapshot
  rotateSelectedElement(elementId: string, rotation: number): PlaygroundAssetHostSnapshot
  rotateSelection(rotation: number): PlaygroundAssetHostSnapshot
  toggleSelectedImageFlip(elementId: string, axis: ImageFlipAxis): PlaygroundAssetHostSnapshot
  toggleSelectedElementFlip(elementId: string, axis: ImageFlipAxis): PlaygroundAssetHostSnapshot
  flipSelection(axis: ImageFlipAxis): PlaygroundAssetHostSnapshot
  updateTextElement(elementId: string, body: TextBody): PlaygroundAssetHostSnapshot
  setThemeColor(themeId: string, slot: ThemeColorSlot, color: Color | null): PlaygroundAssetHostSnapshot
  selectAsset(assetId: string): PlaygroundAssetHostSnapshot
  insertAsset(assetId: string): PlaygroundAssetHostSnapshot
  replaceSelectedImage(assetId: string): PlaygroundAssetHostSnapshot
  uploadAndInsert(input: PlaygroundImageUploadInput): Promise<PlaygroundAssetHostSnapshot>
  uploadAndReplace(input: PlaygroundImageUploadInput): Promise<PlaygroundAssetHostSnapshot>
}

export interface PlaygroundAssetHostOptions {
  adapter?: AssetAdapter
  document?: Ppt4aiDocument
}

export const playgroundSnapOptions: SnapOptions = {
  enabled: true,
  gridSize: 914400,
  threshold: 91440,
}

const redPng = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0, 114, 182, 13, 36,
  0, 0, 0, 17, 73, 68, 65, 84, 120, 156, 99, 120, 239, 226, 242, 31,
  132, 25, 96, 12, 0, 88, 74, 9, 217, 183, 144, 103, 9, 0, 0, 0, 0,
  73, 69, 78, 68, 174, 66, 96, 130,
])

const bluePng = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0, 114, 182, 13, 36,
  0, 0, 0, 17, 73, 68, 65, 84, 120, 156, 99, 80, 77, 126, 253, 31,
  132, 25, 96, 12, 0, 81, 238, 9, 201, 126, 6, 75, 71, 0, 0, 0, 0,
  73, 69, 78, 68, 174, 66, 96, 130,
])

const assets: Record<string, AssetMetadata> = {
  asset_red: { id: 'asset_red', mimeType: 'image/png', pixelWidth: 2, pixelHeight: 2, originalFilename: 'red.png' },
  asset_blue: { id: 'asset_blue', mimeType: 'image/png', pixelWidth: 2, pixelHeight: 2, originalFilename: 'blue.png' },
}

function createMemoryAssetAdapter(): AssetAdapter {
  const stored = new Map<string, Uint8Array>([
    ['asset_red', redPng.slice()],
    ['asset_blue', bluePng.slice()],
  ])
  return {
    async get(assetId) {
      return stored.get(assetId)?.slice()
    },
    async put(assetId, data) {
      stored.set(assetId, data.slice())
    },
  }
}

function createDocument(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_playground',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_playground: { id: 'sld_playground', elementIds: ['group_demo', 'table_demo'], layoutId: 'lay_playground' } },
    themes: { thm_playground: { id: 'thm_playground', colors: {} } },
    masters: { mst_playground: { id: 'mst_playground', themeId: 'thm_playground' } },
    layouts: { lay_playground: { id: 'lay_playground', masterId: 'mst_playground' } },
    elements: {
      shape_demo: { id: 'shape_demo', kind: 'shape', bounds: { x: 914400, y: 685800, w: 2743200, h: 1371600 }, preset: 'roundRect', fill: { color: { type: 'scheme', v: 'accent1' } } },
      text_demo: { id: 'text_demo', kind: 'text', bounds: { x: 914400, y: 914400, w: 2743200, h: 457200 }, body: { paragraphs: [{ runs: [{ text: 'PPT4AI 编辑画布', marks: { fontSize: 280000 } }] }] } },
      group_demo: { id: 'group_demo', kind: 'group', bounds: { x: 914400, y: 685800, w: 2743200, h: 1600200 }, childIds: ['shape_demo', 'text_demo'] },
      table_demo: {
        id: 'table_demo',
        kind: 'table',
        bounds: { x: 914400, y: 2514600, w: 2743200, h: 1143000 },
        columns: [1371600, 1371600],
        rows: [
          { height: 571500, cells: [{ column: 0, fill: { color: { type: 'scheme', v: 'accent2' } }, body: { paragraphs: [{ runs: [{ text: '标题' }] }] } }, { column: 1, fill: { color: { type: 'scheme', v: 'accent2' } }, body: { paragraphs: [{ runs: [{ text: '内容' }] }] } }] },
          { height: 571500, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: '形状' }] }] } }, { column: 1, body: { paragraphs: [{ runs: [{ text: '文本' }] }] } }] },
        ],
      },
    },
    assets: structuredClone(assets),
    slideOrder: ['sld_playground'],
  }
}

export function createPlaygroundAssetHost(options: PlaygroundAssetHostOptions = {}): PlaygroundAssetHost {
  const engine = new EditorEngine(structuredClone(options.document ?? createDocument()), { snap: structuredClone(playgroundSnapOptions) })
  const adapter = options.adapter ?? createMemoryAssetAdapter()
  let selectedAssetId: string | undefined
  let imageSequence = 1
  let assetSequence = 1
  let status: PlaygroundAssetHostSnapshot['status'] = { kind: 'idle', message: '' }
  const imageAssetController = createImageAssetController({
    engine,
    assetAdapter: adapter,
    assetIdFactory: () => {
      return `asset_upload_${assetSequence}`
    },
  })
  const currentSlideId = (): string => engine.getState().document.slideOrder[0]!

  const snapshot = (): PlaygroundAssetHostSnapshot => structuredClone({
    engineState: engine.getState(),
    ...(selectedAssetId ? { selectedAssetId } : {}),
    status,
  })

  const hasAsset = (assetId: string): boolean => Boolean(engine.getState().document.assets?.[assetId])
  const fail = (message: string): PlaygroundAssetHostSnapshot => {
    status = { kind: 'error', message }
    return snapshot()
  }
  const selectElements = (elementIds: string[]): PlaygroundAssetHostSnapshot => {
    const validElementIds = elementIds.filter((elementId, index) => (
      elementIds.indexOf(elementId) === index && Boolean(engine.getState().document.elements[elementId])
    ))
    engine.dispatch({ type: 'select', elementIds: validElementIds })
    return snapshot()
  }

  return {
    adapter,
    snapOptions: structuredClone(playgroundSnapOptions),
    getSnapshot: snapshot,
    undo() {
      if (engine.getState().history.undoDepth === 0) return fail('undo-unavailable')
      engine.dispatch({ type: 'undo' })
      status = { kind: 'success', message: 'edit-undone' }
      return snapshot()
    },
    redo() {
      if (engine.getState().history.redoDepth === 0) return fail('redo-unavailable')
      engine.dispatch({ type: 'redo' })
      status = { kind: 'success', message: 'edit-redone' }
      return snapshot()
    },
    insertElements(rootElementIds, elements, assets) {
      try {
        engine.dispatch({ type: 'insertElements', slideId: currentSlideId(), rootElementIds, elements, assets })
        status = { kind: 'success', message: 'elements-pasted' }
      } catch {
        return fail('element-paste-failed')
      }
      return snapshot()
    },
    selectAsset(assetId) {
      if (!hasAsset(assetId)) return fail('asset-missing')
      selectedAssetId = assetId
      status = { kind: 'success', message: 'asset-selected' }
      return snapshot()
    },
    selectElements,
    selectElement(elementId) {
      return selectElements(elementId ? [elementId] : [])
    },
    moveSelected(elementId, dx, dy) {
      if (!engine.getState().document.elements[elementId]) return fail('element-missing')
      if (!engine.getState().selection.includes(elementId)) engine.dispatch({ type: 'select', elementIds: [elementId] })
      try {
        engine.dispatch({ type: 'move', dx, dy })
        status = { kind: 'success', message: 'element-moved' }
      } catch {
        return fail('element-operation-failed')
      }
      return snapshot()
    },
    groupSelected() {
      try {
        engine.dispatch({ type: 'group' })
      } catch {
        return fail('element-operation-failed')
      }
      return snapshot()
    },
    ungroupSelected(groupId) {
      try {
        engine.dispatch({ type: 'ungroup', groupId })
      } catch {
        return fail('element-operation-failed')
      }
      return snapshot()
    },
    resizeSelected(elementIds, bounds) {
      const validElementIds = elementIds.filter((elementId, index) => (
        elementIds.indexOf(elementId) === index && Boolean(engine.getState().document.elements[elementId])
      ))
      if (validElementIds.length === 0) return fail('element-missing')
      const previousSelection = engine.getState().selection
      engine.dispatch({ type: 'select', elementIds: validElementIds })
      try {
        engine.dispatch({ type: 'resizeSelection', bounds })
        status = { kind: 'success', message: 'element-resized' }
      } catch {
        engine.dispatch({ type: 'select', elementIds: previousSelection })
        return fail('element-operation-failed')
      }
      return snapshot()
    },
    resizeElement(elementId, bounds) {
      if (!engine.getState().document.elements[elementId]) return fail('element-missing')
      try {
        engine.dispatch({ type: 'resize', elementId, bounds })
        engine.dispatch({ type: 'select', elementIds: [elementId] })
        status = { kind: 'success', message: 'element-resized' }
      } catch {
        return fail('element-operation-failed')
      }
      return snapshot()
    },
    rotateSelectedImage(elementId, rotation) {
      const element = engine.getState().document.elements[elementId]
      if (!element || element.kind !== 'image') return fail('element-operation-failed')
      try {
        engine.dispatch({ type: 'setImageRotation', elementId, rotation })
        status = { kind: 'success', message: 'image-rotated' }
      } catch {
        return fail('element-operation-failed')
      }
      return snapshot()
    },
    rotateSelectedElement(elementId, rotation) {
      const element = engine.getState().document.elements[elementId]
      if (!element || element.kind === 'image') return fail('element-operation-failed')
      try {
        engine.dispatch({ type: 'setElementRotation', elementId, rotation })
        status = { kind: 'success', message: 'element-rotated' }
      } catch {
        return fail('element-operation-failed')
      }
      return snapshot()
    },
    rotateSelection(rotation) {
      try {
        engine.dispatch({ type: 'rotateSelection', rotation })
        status = { kind: 'success', message: 'element-rotated' }
      } catch {
        return fail('element-operation-failed')
      }
      return snapshot()
    },
    toggleSelectedImageFlip(elementId, axis) {
      const element = engine.getState().document.elements[elementId]
      if (!element || element.kind !== 'image') return fail('element-operation-failed')
      try {
        engine.dispatch({ type: 'toggleImageFlip', elementId, axis })
        status = { kind: 'success', message: 'image-flipped' }
      } catch {
        return fail('element-operation-failed')
      }
      return snapshot()
    },
    toggleSelectedElementFlip(elementId, axis) {
      const element = engine.getState().document.elements[elementId]
      if (!element || element.kind === 'image') return fail('element-operation-failed')
      try {
        engine.dispatch({ type: 'toggleElementFlip', elementId, axis })
        status = { kind: 'success', message: 'element-flipped' }
      } catch {
        return fail('element-operation-failed')
      }
      return snapshot()
    },
    flipSelection(axis) {
      try {
        engine.dispatch({ type: 'flipSelection', axis })
        status = { kind: 'success', message: 'element-flipped' }
      } catch {
        return fail('element-operation-failed')
      }
      return snapshot()
    },
    updateTextElement(elementId, body) {
      if (!engine.getState().document.elements[elementId]) return fail('element-missing')
      try {
        engine.dispatch({ type: 'setTextBody', elementId, body })
        engine.dispatch({ type: 'select', elementIds: [elementId] })
        status = { kind: 'success', message: 'text-updated' }
      } catch {
        return fail('element-operation-failed')
      }
      return snapshot()
    },
    setThemeColor(themeId, slot, color) {
      if (!engine.getState().document.themes?.[themeId]) return fail('theme-missing')
      try {
        engine.dispatch({ type: 'setThemeColor', themeId, slot, color })
        status = { kind: 'success', message: 'theme-color-updated' }
      } catch {
        return fail('theme-color-failed')
      }
      return snapshot()
    },
    insertAsset(assetId) {
      if (!hasAsset(assetId)) return fail('asset-missing')
      const element: ImageElement = {
        id: `image_${imageSequence}`,
        kind: 'image',
        bounds: { x: 1219200, y: 1143000, w: 3657600, h: 2057400 },
        assetId,
      }
      try {
        engine.dispatch({ type: 'insertImageReference', slideId: currentSlideId(), element, assetId })
        imageSequence += 1
        selectedAssetId = assetId
        status = { kind: 'success', message: 'asset-inserted' }
      } catch {
        return fail('asset-operation-failed')
      }
      return snapshot()
    },
    replaceSelectedImage(assetId) {
      if (!hasAsset(assetId)) return fail('asset-missing')
      const state = engine.getState()
      const selectedElement = state.selection.length === 1 ? state.document.elements[state.selection[0]!] : undefined
      if (selectedElement?.kind !== 'image') return fail('image-target-required')
      try {
        engine.dispatch({ type: 'replaceImageAssetReference', elementId: selectedElement.id, assetId })
        selectedAssetId = assetId
        status = { kind: 'success', message: 'asset-replaced' }
      } catch {
        return fail('asset-operation-failed')
      }
      return snapshot()
    },
    async uploadAndInsert(input) {
      const elementId = `image_${imageSequence}`
      const assetId = `asset_upload_${assetSequence}`
      try {
        const state = await imageAssetController.insert({
          slideId: currentSlideId(),
          elementId,
          bounds: { x: 1219200, y: 1143000, w: 3657600, h: 2057400 },
          ...structuredClone(input),
        })
        imageSequence += 1
        assetSequence += 1
        selectedAssetId = assetId
        status = { kind: 'success', message: 'asset-uploaded' }
        return structuredClone({ engineState: state, selectedAssetId, status })
      } catch (error) {
        const message = error instanceof ImageAssetControllerError
          && (error.message === 'unsupported or malformed bitmap data' || error.message.startsWith('declared image MIME'))
          ? 'image-upload-invalid'
          : 'image-upload-failed'
        status = { kind: 'error', message }
        return snapshot()
      }
    },
    async uploadAndReplace(input) {
      const state = engine.getState()
      const selectedElement = state.selection.length === 1 ? state.document.elements[state.selection[0]!] : undefined
      if (selectedElement?.kind !== 'image') return fail('image-target-required')
      const assetId = `asset_upload_${assetSequence}`
      try {
        const nextState = await imageAssetController.replace({
          elementId: selectedElement.id,
          ...structuredClone(input),
        })
        assetSequence += 1
        selectedAssetId = assetId
        status = { kind: 'success', message: 'asset-upload-replaced' }
        return structuredClone({ engineState: nextState, selectedAssetId, status })
      } catch (error) {
        const message = error instanceof ImageAssetControllerError
          && (error.message === 'unsupported or malformed bitmap data' || error.message.startsWith('declared image MIME'))
          ? 'image-upload-invalid'
          : 'image-upload-failed'
        status = { kind: 'error', message }
        return snapshot()
      }
    },
  }
}

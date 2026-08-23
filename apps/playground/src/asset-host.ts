import { EditorEngine, type EngineState } from '@ppt4ai/engine'
import { createImageAssetController, ImageAssetControllerError } from '@ppt4ai/editor'
import type { AssetAdapter, AssetMetadata, ImageElement, Ppt4aiDocument, Rect, TextBody } from '@ppt4ai/model'
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
  getSnapshot(): PlaygroundAssetHostSnapshot
  selectElement(elementId: string | undefined): PlaygroundAssetHostSnapshot
  moveSelected(elementId: string, dx: number, dy: number): PlaygroundAssetHostSnapshot
  resizeElement(elementId: string, bounds: Rect): PlaygroundAssetHostSnapshot
  updateTextElement(elementId: string, body: TextBody): PlaygroundAssetHostSnapshot
  selectAsset(assetId: string): PlaygroundAssetHostSnapshot
  insertAsset(assetId: string): PlaygroundAssetHostSnapshot
  replaceSelectedImage(assetId: string): PlaygroundAssetHostSnapshot
  uploadAndInsert(input: PlaygroundImageUploadInput): Promise<PlaygroundAssetHostSnapshot>
  uploadAndReplace(input: PlaygroundImageUploadInput): Promise<PlaygroundAssetHostSnapshot>
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
    slides: { sld_playground: { id: 'sld_playground', elementIds: ['shape_demo', 'text_demo', 'table_demo'] } },
    elements: {
      shape_demo: { id: 'shape_demo', kind: 'shape', bounds: { x: 914400, y: 685800, w: 2743200, h: 1371600 }, preset: 'roundRect', fill: { color: { type: 'srgb', v: 'DDEBFF' } } },
      text_demo: { id: 'text_demo', kind: 'text', bounds: { x: 914400, y: 914400, w: 2743200, h: 457200 }, body: { paragraphs: [{ runs: [{ text: 'PPT4AI 编辑画布', marks: { fontSize: 280000 } }] }] } },
      table_demo: {
        id: 'table_demo',
        kind: 'table',
        bounds: { x: 914400, y: 2514600, w: 2743200, h: 1143000 },
        columns: [1371600, 1371600],
        rows: [
          { height: 571500, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: '标题' }] }] } }, { column: 1, body: { paragraphs: [{ runs: [{ text: '内容' }] }] } }] },
          { height: 571500, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: '形状' }] }] } }, { column: 1, body: { paragraphs: [{ runs: [{ text: '文本' }] }] } }] },
        ],
      },
    },
    assets: structuredClone(assets),
    slideOrder: ['sld_playground'],
  }
}

export function createPlaygroundAssetHost(): PlaygroundAssetHost {
  const engine = new EditorEngine(createDocument())
  const adapter = createMemoryAssetAdapter()
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

  return {
    adapter,
    getSnapshot: snapshot,
    selectAsset(assetId) {
      if (!hasAsset(assetId)) return fail('asset-missing')
      selectedAssetId = assetId
      status = { kind: 'success', message: 'asset-selected' }
      return snapshot()
    },
    selectElement(elementId) {
      const elementIds = elementId && engine.getState().document.elements[elementId] ? [elementId] : []
      engine.dispatch({ type: 'select', elementIds })
      return snapshot()
    },
    moveSelected(elementId, dx, dy) {
      if (!engine.getState().document.elements[elementId]) return fail('element-missing')
      engine.dispatch({ type: 'select', elementIds: [elementId] })
      try {
        engine.dispatch({ type: 'move', dx, dy })
        status = { kind: 'success', message: 'element-moved' }
      } catch {
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
    insertAsset(assetId) {
      if (!hasAsset(assetId)) return fail('asset-missing')
      const element: ImageElement = {
        id: `image_${imageSequence}`,
        kind: 'image',
        bounds: { x: 1219200, y: 1143000, w: 3657600, h: 2057400 },
        assetId,
      }
      try {
        engine.dispatch({ type: 'insertImageReference', slideId: 'sld_playground', element, assetId })
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
          slideId: 'sld_playground',
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

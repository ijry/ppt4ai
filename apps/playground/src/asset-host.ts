import { EditorEngine, type EngineState } from '@ppt4ai/engine'
import type { AssetAdapter, AssetMetadata, ImageElement, Ppt4aiDocument } from '@ppt4ai/model'

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
  selectAsset(assetId: string): PlaygroundAssetHostSnapshot
  insertAsset(assetId: string): PlaygroundAssetHostSnapshot
  replaceSelectedImage(assetId: string): PlaygroundAssetHostSnapshot
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
    slides: { sld_playground: { id: 'sld_playground', elementIds: [] } },
    elements: {},
    assets: structuredClone(assets),
    slideOrder: ['sld_playground'],
  }
}

export function createPlaygroundAssetHost(): PlaygroundAssetHost {
  const engine = new EditorEngine(createDocument())
  let selectedAssetId: string | undefined
  let imageSequence = 1
  let status: PlaygroundAssetHostSnapshot['status'] = { kind: 'idle', message: '' }

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
    adapter: createMemoryAssetAdapter(),
    getSnapshot: snapshot,
    selectAsset(assetId) {
      if (!hasAsset(assetId)) return fail('asset-missing')
      selectedAssetId = assetId
      status = { kind: 'success', message: 'asset-selected' }
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
  }
}

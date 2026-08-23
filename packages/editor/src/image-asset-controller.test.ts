import { describe, expect, it } from 'vitest'
import { EditorEngine } from '@ppt4ai/engine'
import type { AssetAdapter, AssetMetadata, ImageElement, Ppt4aiDocument } from '@ppt4ai/model'
import {
  createImageAssetController,
  ImageAssetControllerError,
} from './image-asset-controller'

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
  0, 0, 0, 12, 0, 0, 0, 34,
])

const jpegBytes = new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0, 0x11, 8, 0, 24, 0, 40,
  3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0,
])

function makeDocument(withImage = false): Ppt4aiDocument {
  const document: Ppt4aiDocument = {
    format: 'ppt4ai', version: 1, id: 'deck',
    page: { w: 10000000, h: 6000000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [] } },
    elements: {},
    slideOrder: ['sld_1'],
  }
  if (withImage) {
    const image: ImageElement = {
      id: 'img_1', kind: 'image', assetId: 'asset_old',
      bounds: { x: 10, y: 20, w: 300, h: 400 },
      transform: { rotation: 60000, flipV: true },
      sourceCrop: { left: 1000 },
      maskPreset: 'ellipse',
      effects: [{ type: 'grayscl' }],
    }
    document.elements[image.id] = image
    document.slides.sld_1!.elementIds.push(image.id)
    document.assets = { asset_old: { id: 'asset_old', mimeType: 'image/png', pixelWidth: 4, pixelHeight: 5 } }
  }
  return document
}

class RecordingAdapter implements AssetAdapter {
  readonly writes: Array<{ assetId: string; data: Uint8Array; metadata: AssetMetadata }> = []
  beforeWrite?: () => void
  failure?: Error

  async get(): Promise<Uint8Array | undefined> { return undefined }

  async put(assetId: string, data: Uint8Array, metadata: AssetMetadata): Promise<void> {
    this.beforeWrite?.()
    if (this.failure) throw this.failure
    this.writes.push({ assetId, data, metadata })
  }
}

describe('image asset controller', () => {
  it('stores validated bytes before inserting clone-safe metadata', async () => {
    const engine = new EditorEngine(makeDocument())
    const adapter = new RecordingAdapter()
    adapter.beforeWrite = () => expect(engine.getState().history.undoDepth).toBe(0)
    const controller = createImageAssetController({ engine, assetAdapter: adapter, assetIdFactory: () => 'asset_new' })
    const inputBytes = pngBytes.slice()

    const state = await controller.insert({
      slideId: 'sld_1', elementId: 'img_new', bounds: { x: 1, y: 2, w: 30, h: 40 },
      data: inputBytes, mimeType: 'image/png', originalFilename: 'photo.png',
    })

    expect(adapter.writes).toEqual([{
      assetId: 'asset_new', data: pngBytes,
      metadata: { id: 'asset_new', mimeType: 'image/png', pixelWidth: 12, pixelHeight: 34, originalFilename: 'photo.png' },
    }])
    expect(state.document.elements.img_new).toEqual({
      id: 'img_new', kind: 'image', assetId: 'asset_new', bounds: { x: 1, y: 2, w: 30, h: 40 },
    })
    expect(state.history.undoDepth).toBe(1)
    inputBytes[0] = 0
    expect(adapter.writes[0]?.data).toEqual(pngBytes)
    expect(structuredClone(state)).toEqual(state)
  })

  it('replaces only the asset reference and metadata', async () => {
    const engine = new EditorEngine(makeDocument(true))
    const before = engine.getState().document.elements.img_1
    const adapter = new RecordingAdapter()
    const controller = createImageAssetController({ engine, assetAdapter: adapter, assetIdFactory: () => 'asset_new' })

    const state = await controller.replace({ elementId: 'img_1', data: jpegBytes, originalFilename: 'replacement.jpg' })

    expect(state.document.elements.img_1).toEqual({ ...before, assetId: 'asset_new' })
    expect(state.document.assets).toEqual({
      asset_new: { id: 'asset_new', mimeType: 'image/jpeg', pixelWidth: 40, pixelHeight: 24, originalFilename: 'replacement.jpg' },
    })
  })

  it('rejects malformed data before allocating or writing an asset', async () => {
    const engine = new EditorEngine(makeDocument())
    const adapter = new RecordingAdapter()
    let allocations = 0
    const controller = createImageAssetController({ engine, assetAdapter: adapter, assetIdFactory: () => `asset_${++allocations}` })
    const before = engine.getState()

    await expect(controller.insert({
      slideId: 'sld_1', elementId: 'img_new', bounds: { x: 1, y: 2, w: 3, h: 4 }, data: new Uint8Array([1, 2, 3]),
    })).rejects.toMatchObject({ orphanAssetIds: [] })
    expect(allocations).toBe(0)
    expect(adapter.writes).toEqual([])
    expect(engine.getState()).toEqual(before)
  })

  it('rejects a declared MIME mismatch before allocating an asset', async () => {
    const engine = new EditorEngine(makeDocument())
    const adapter = new RecordingAdapter()
    let allocations = 0
    const controller = createImageAssetController({ engine, assetAdapter: adapter, assetIdFactory: () => `asset_${++allocations}` })

    await expect(controller.insert({
      slideId: 'sld_1', elementId: 'img_new', bounds: { x: 1, y: 2, w: 3, h: 4 }, data: pngBytes, mimeType: 'image/jpeg',
    })).rejects.toThrow('declared image MIME does not match bitmap data: image/jpeg != image/png')
    expect(allocations).toBe(0)
    expect(adapter.writes).toEqual([])
  })

  it('keeps the engine unchanged when adapter storage fails', async () => {
    const engine = new EditorEngine(makeDocument())
    const adapter = new RecordingAdapter()
    adapter.failure = new Error('storage unavailable')
    const controller = createImageAssetController({ engine, assetAdapter: adapter, assetIdFactory: () => 'asset_new' })
    const before = engine.getState()

    await expect(controller.insert({
      slideId: 'sld_1', elementId: 'img_new', bounds: { x: 1, y: 2, w: 3, h: 4 }, data: pngBytes,
    })).rejects.toMatchObject({ orphanAssetIds: [], cause: adapter.failure })
    expect(engine.getState()).toEqual(before)
  })

  it('reports an orphan when dispatch fails after storage succeeds', async () => {
    const engine = new EditorEngine(makeDocument(true))
    const adapter = new RecordingAdapter()
    const controller = createImageAssetController({ engine, assetAdapter: adapter, assetIdFactory: () => 'asset_new' })
    const before = engine.getState()

    await expect(controller.insert({
      slideId: 'sld_1', elementId: 'img_1', bounds: { x: 1, y: 2, w: 3, h: 4 }, data: pngBytes,
    })).rejects.toMatchObject({ orphanAssetIds: ['asset_new'] })
    expect(adapter.writes).toHaveLength(1)
    expect(engine.getState()).toEqual(before)
  })

  it('exports the controller API from the editor entry point', async () => {
    const editor = await import('./index')
    expect(editor.createImageAssetController).toBe(createImageAssetController)
    expect(editor.ImageAssetControllerError).toBe(ImageAssetControllerError)
  })
})

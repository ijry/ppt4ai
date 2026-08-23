import { describe, expect, it } from 'vitest'
import { createPlaygroundAssetHost } from './asset-host'

const uploadPng = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 3, 0, 0, 0, 4, 8, 6, 0, 0, 0, 0, 0, 0, 0,
])

describe('createPlaygroundAssetHost', () => {
  it('seeds clone-isolated assets and returns clone-safe snapshots', async () => {
    const host = createPlaygroundAssetHost()
    const snapshot = host.getSnapshot()
    const firstBytes = await host.adapter.get('asset_red')

    expect(Object.keys(snapshot.engineState.document.assets ?? {})).toEqual(['asset_red', 'asset_blue'])
    expect(snapshot.engineState.document.slides.sld_playground?.elementIds).toEqual(['shape_demo', 'text_demo', 'table_demo'])
    expect(Object.keys(snapshot.engineState.document.elements)).toEqual(['shape_demo', 'text_demo', 'table_demo'])
    expect(firstBytes).toBeInstanceOf(Uint8Array)

    snapshot.engineState.document.assets!.asset_red!.originalFilename = 'mutated.png'
    firstBytes![0] = 0
    expect(host.getSnapshot().engineState.document.assets!.asset_red!.originalFilename).toBe('red.png')
    expect((await host.adapter.get('asset_red'))![0]).toBe(0x89)
  })

  it('selects a seeded element without adding an undo entry', () => {
    const host = createPlaygroundAssetHost()

    const selected = host.selectElement('text_demo')

    expect(selected.engineState.selection).toEqual(['text_demo'])
    expect(selected.engineState.history).toEqual({ undoDepth: 0, redoDepth: 0 })
  })

  it('moves and resizes the selected seeded element as undoable commands', () => {
    const host = createPlaygroundAssetHost()
    host.selectElement('text_demo')

    const moved = host.moveSelected('text_demo', 914400, 0)
    expect(moved.engineState.document.elements.text_demo?.bounds.x).toBe(1828800)
    expect(moved.engineState.history).toEqual({ undoDepth: 1, redoDepth: 0 })

    const resized = host.resizeElement('text_demo', { x: 1828800, y: 914400, w: 3657600, h: 914400 })
    expect(resized.engineState.document.elements.text_demo?.bounds).toEqual({ x: 1828800, y: 914400, w: 3657600, h: 914400 })
    expect(resized.engineState.history).toEqual({ undoDepth: 2, redoDepth: 0 })
  })

  it('inserts and replaces existing asset references without writing adapter bytes', () => {
    const host = createPlaygroundAssetHost()
    let putCalls = 0
    const adapter = host.adapter
    const originalPut = adapter.put
    adapter.put = async (...args) => {
      putCalls += 1
      await originalPut(...args)
    }

    const inserted = host.insertAsset('asset_red')
    expect(inserted.engineState.selection).toEqual(['image_1'])
    expect(inserted.engineState.document.elements.image_1).toMatchObject({ kind: 'image', assetId: 'asset_red' })
    expect(inserted.engineState.history).toEqual({ undoDepth: 1, redoDepth: 0 })

    host.selectAsset('asset_blue')
    const replaced = host.replaceSelectedImage('asset_blue')
    expect(replaced.engineState.document.elements.image_1).toMatchObject({ kind: 'image', assetId: 'asset_blue' })
    expect(replaced.engineState.history).toEqual({ undoDepth: 2, redoDepth: 0 })
    expect(putCalls).toBe(0)
  })

  it('reports missing assets and missing image targets without changing history', () => {
    const host = createPlaygroundAssetHost()
    const missingAsset = host.insertAsset('asset_missing')
    expect(missingAsset.status.kind).toBe('error')
    expect(missingAsset.status.message).toBe('asset-missing')
    expect(missingAsset.engineState.history).toEqual({ undoDepth: 0, redoDepth: 0 })

    const missingTarget = host.replaceSelectedImage('asset_blue')
    expect(missingTarget.status.kind).toBe('error')
    expect(missingTarget.status.message).toBe('image-target-required')
    expect(missingTarget.engineState.history).toEqual({ undoDepth: 0, redoDepth: 0 })
  })

  it('uploads a valid bitmap, stores exact bytes, and inserts a deterministic image reference', async () => {
    const host = createPlaygroundAssetHost()

    const result = await host.uploadAndInsert({
      data: uploadPng,
      mimeType: 'image/png',
      originalFilename: 'uploaded.png',
    })

    expect(result.status).toEqual({ kind: 'success', message: 'asset-uploaded' })
    expect(result.selectedAssetId).toBe('asset_upload_1')
    expect(result.engineState.selection).toEqual(['image_1'])
    expect(result.engineState.document.elements.image_1).toMatchObject({
      kind: 'image',
      assetId: 'asset_upload_1',
    })
    expect(result.engineState.document.assets?.asset_upload_1).toMatchObject({
      id: 'asset_upload_1',
      mimeType: 'image/png',
      pixelWidth: 3,
      pixelHeight: 4,
      originalFilename: 'uploaded.png',
    })
    expect(await host.adapter.get('asset_upload_1')).toEqual(uploadPng)
    expect(result.engineState.history).toEqual({ undoDepth: 1, redoDepth: 0 })
  })

  it('uploads a second bitmap to replace the selected image and preserves old adapter bytes', async () => {
    const host = createPlaygroundAssetHost()
    await host.uploadAndInsert({ data: uploadPng, mimeType: 'image/png', originalFilename: 'one.png' })
    const replacement = new Uint8Array(uploadPng)
    replacement[35] = 7

    const result = await host.uploadAndReplace({ data: replacement, mimeType: 'image/png', originalFilename: 'two.png' })

    expect(result.status.message).toBe('asset-upload-replaced')
    expect(result.selectedAssetId).toBe('asset_upload_2')
    expect(result.engineState.document.elements.image_1).toMatchObject({ assetId: 'asset_upload_2' })
    expect(result.engineState.document.assets?.asset_upload_1).toBeUndefined()
    expect(await host.adapter.get('asset_upload_1')).toEqual(uploadPng)
    expect(await host.adapter.get('asset_upload_2')).toEqual(replacement)
    expect(result.engineState.history).toEqual({ undoDepth: 2, redoDepth: 0 })
  })

  it('rejects invalid upload bytes without writing, advancing IDs, or changing history', async () => {
    const host = createPlaygroundAssetHost()

    const invalid = await host.uploadAndInsert({ data: new Uint8Array([1, 2, 3]), originalFilename: 'bad.png' })

    expect(invalid.status).toEqual({ kind: 'error', message: 'image-upload-invalid' })
    expect(invalid.engineState.history).toEqual({ undoDepth: 0, redoDepth: 0 })
    expect(invalid.engineState.document.assets?.asset_upload_1).toBeUndefined()
    const valid = await host.uploadAndInsert({ data: uploadPng, mimeType: 'image/png', originalFilename: 'good.png' })
    expect(valid.selectedAssetId).toBe('asset_upload_1')
  })

  it('rejects upload replacement without an image target', async () => {
    const host = createPlaygroundAssetHost()

    const result = await host.uploadAndReplace({ data: uploadPng, mimeType: 'image/png', originalFilename: 'replacement.png' })

    expect(result.status).toEqual({ kind: 'error', message: 'image-target-required' })
    expect(result.engineState.history).toEqual({ undoDepth: 0, redoDepth: 0 })
    expect(result.engineState.document.assets?.asset_upload_1).toBeUndefined()
  })

  it('hides adapter and engine failures behind a stable upload status', async () => {
    const host = createPlaygroundAssetHost()
    host.adapter.put = async () => { throw new Error('secret adapter failure') }

    const result = await host.uploadAndInsert({ data: uploadPng, mimeType: 'image/png', originalFilename: 'failed.png' })

    expect(result.status).toEqual({ kind: 'error', message: 'image-upload-failed' })
    expect(result.engineState.history).toEqual({ undoDepth: 0, redoDepth: 0 })
    expect(result.status.message).not.toContain('secret')
  })
})

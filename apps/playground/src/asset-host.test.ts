import { describe, expect, it } from 'vitest'
import { createPlaygroundAssetHost } from './asset-host'

describe('createPlaygroundAssetHost', () => {
  it('seeds clone-isolated assets and returns clone-safe snapshots', async () => {
    const host = createPlaygroundAssetHost()
    const snapshot = host.getSnapshot()
    const firstBytes = await host.adapter.get('asset_red')

    expect(Object.keys(snapshot.engineState.document.assets ?? {})).toEqual(['asset_red', 'asset_blue'])
    expect(snapshot.engineState.document.slides.sld_playground?.elementIds).toEqual([])
    expect(firstBytes).toBeInstanceOf(Uint8Array)

    snapshot.engineState.document.assets!.asset_red!.originalFilename = 'mutated.png'
    firstBytes![0] = 0
    expect(host.getSnapshot().engineState.document.assets!.asset_red!.originalFilename).toBe('red.png')
    expect((await host.adapter.get('asset_red'))![0]).toBe(0x89)
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
})

import type { AssetMetadata } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createAssetLibraryModel } from './asset-library'

describe('createAssetLibraryModel', () => {
  it('sorts assets by filename and then id without mutating input', () => {
    const assets = {
      z: { id: 'z', mimeType: 'image/png', originalFilename: 'Zoo.png' },
      a: { id: 'a', mimeType: 'image/jpeg', originalFilename: 'alpha.jpg' },
    } satisfies Record<string, AssetMetadata>

    const model = createAssetLibraryModel(assets, 'z')

    expect(model.items.map((item) => item.id)).toEqual(['a', 'z'])
    expect(model.selectedAssetId).toBe('z')
    expect(assets).toEqual({
      z: { id: 'z', mimeType: 'image/png', originalFilename: 'Zoo.png' },
      a: { id: 'a', mimeType: 'image/jpeg', originalFilename: 'alpha.jpg' },
    })
  })

  it('derives stable format, dimensions, and fallback labels', () => {
    const model = createAssetLibraryModel({
      asset: { id: 'asset', mimeType: 'image/webp', pixelWidth: 320, pixelHeight: 180 },
      unknown: { id: 'unknown', mimeType: 'image/gif' },
    })

    expect(model.items[0]).toMatchObject({ formatLabel: 'WEBP', dimensionsLabel: '320 × 180', displayName: 'asset' })
    expect(model.items[1]).toMatchObject({ formatLabel: 'GIF', dimensionsLabel: 'unknown', displayName: 'unknown' })
  })

  it('clears a selected id that is absent from the asset map', () => {
    expect(createAssetLibraryModel({}, 'missing').selectedAssetId).toBeUndefined()
  })
})

import type { AssetMetadata, Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { documentToSceneGraph } from './index'

const photo: AssetMetadata = { id: 'asset_photo', mimeType: 'image/png', pixelWidth: 32, pixelHeight: 16 }

/** `exactOptionalPropertyTypes` refuses an explicitly `undefined` optional, hence the conditional spreads. */
function documentWith(background: NonNullable<Ppt4aiDocument['slides'][string]['background']>, onLayout = false): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_background_picture',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [], layoutId: 'lyt_1', ...(onLayout ? {} : { background }) } },
    slideOrder: ['sld_1'],
    elements: {},
    layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1', ...(onLayout ? { background } : {}) } },
    masters: { mst_1: { id: 'mst_1' } },
    assets: { asset_photo: photo },
  }
}

describe('photo background in the scene graph', () => {
  it('carries the fill with its metadata inlined', () => {
    const scene = documentToSceneGraph(documentWith({ pictureFill: { assetId: 'asset_photo', sourceCrop: { left: 5000 } } }))

    expect(scene.backgroundPicture).toEqual({ assetId: 'asset_photo', metadata: photo, sourceCrop: { left: 5000 } })
  })

  /** `p:bg` replaces its inherited counterpart whole, so a layout photo reaches a slide that declares none. */
  it('inherits the layout background picture', () => {
    const scene = documentToSceneGraph(documentWith({ pictureFill: { assetId: 'asset_photo' } }, true))

    expect(scene.backgroundPicture?.assetId).toBe('asset_photo')
  })

  it('leaves the field absent for a colour background', () => {
    const scene = documentToSceneGraph(documentWith({ fill: { color: { type: 'srgb', v: '1F3864' } } }))

    expect(scene.backgroundPicture).toBeUndefined()
    expect(scene.background).toEqual({ rgb: '1F3864', alpha: 100000 })
  })
})

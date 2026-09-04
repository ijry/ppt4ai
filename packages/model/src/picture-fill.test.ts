import { describe, expect, it } from 'vitest'
import { validateDocument, type PictureFill, type Ppt4aiDocument } from './index'

function documentWith(pictureFill: unknown, kind: 'shape' | 'text' = 'shape', withAsset = true): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_picture_fill',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_shape'] } },
    slideOrder: ['sld_1'],
    ...(withAsset ? { assets: { asset_photo: { id: 'asset_photo', mimeType: 'image/png' } } } : {}),
    elements: {
      el_shape: {
        id: 'el_shape',
        kind,
        ...(kind === 'shape' ? { preset: 'rect' } : {}),
        bounds: { x: 0, y: 0, w: 100, h: 100 },
        pictureFill,
      },
    },
  } as unknown as Ppt4aiDocument
}

function errorsFor(pictureFill: unknown, kind: 'shape' | 'text' = 'shape', withAsset = true): string[] {
  const result = validateDocument(documentWith(pictureFill, kind, withAsset))
  return result.valid ? [] : result.errors
}

const photo: PictureFill = { assetId: 'asset_photo' }

describe('picture fill validation', () => {
  it('accepts a picture fill on a shape and on text', () => {
    expect(errorsFor(photo)).toEqual([])
    expect(errorsFor(photo, 'text')).toEqual([])
  })

  it('accepts a source crop within range', () => {
    expect(errorsFor({ assetId: 'asset_photo', sourceCrop: { left: 10000, top: 0, right: 20000, bottom: 100000 } })).toEqual([])
  })

  /** The same rule an image's `assetId` gets: an unanswerable reference paints an empty shape. */
  it('rejects an asset the document does not carry', () => {
    expect(errorsFor(photo, 'shape', false)).toContain('elements.el_shape.pictureFill references missing asset: asset_photo')
  })

  it('rejects an empty or non-string asset id', () => {
    expect(errorsFor({ assetId: '' })).toContain('elements.el_shape.pictureFill.assetId must be a non-empty string')
    expect(errorsFor({ assetId: 7 })).toContain('elements.el_shape.pictureFill.assetId must be a non-empty string')
  })

  it('rejects a picture fill that is not an object', () => {
    expect(errorsFor('photo.png')).toContain('elements.el_shape.pictureFill must be an object')
  })

  it('rejects a crop side outside the modeled range', () => {
    expect(errorsFor({ assetId: 'asset_photo', sourceCrop: { left: 100001 } }))
      .toContain('elements.el_shape.pictureFill.sourceCrop.left must be between 0 and 100000')
    expect(errorsFor({ assetId: 'asset_photo', sourceCrop: { top: -1 } }))
      .toContain('elements.el_shape.pictureFill.sourceCrop.top must be between 0 and 100000')
  })

  it('rejects a crop that is not an object', () => {
    expect(errorsFor({ assetId: 'asset_photo', sourceCrop: 'half' }))
      .toContain('elements.el_shape.pictureFill.sourceCrop must be an object')
  })

  /**
   * OOXML has exactly one fill node, so only a hand-built document carries both. The model allows it
   * and the scene gives the picture precedence rather than erroring on a shape it can still paint.
   */
  it('accepts a colour fill alongside a picture fill', () => {
    const document = documentWith(photo)
    const element = document.elements.el_shape
    if (element?.kind !== 'shape') throw new Error('fixture must be a shape')
    element.fill = { color: { type: 'srgb', v: '4472C4' } }

    expect(validateDocument(document).valid).toBe(true)
  })
})

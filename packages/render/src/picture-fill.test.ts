import { describe, expect, it } from 'vitest'
import type { AssetMetadata, Element, Ppt4aiDocument, Theme } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

const theme: Theme = {
  id: 'theme-1',
  colors: { accent1: { type: 'srgb', v: '4472C4' } },
  formatScheme: { fillStyles: [{ color: { type: 'scheme', v: 'phClr' } }] },
}

const photo: AssetMetadata = { id: 'asset_photo', mimeType: 'image/png', pixelWidth: 32, pixelHeight: 16 }

function documentWith(element: Element, assets: Record<string, AssetMetadata> = { asset_photo: photo }): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_picture_fill',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [element.id], layoutId: 'lyt_1' } },
    slideOrder: ['sld_1'],
    elements: { [element.id]: element },
    layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } },
    masters: { mst_1: { id: 'mst_1', themeId: 'theme-1' } },
    themes: { 'theme-1': theme },
    assets,
  }
}

const bounds = { x: 1000000, y: 1000000, w: 2000000, h: 1000000 }

describe('picture fill in the scene graph', () => {
  it('carries the fill and inlines its asset metadata', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_shape',
      kind: 'shape',
      preset: 'roundRect',
      bounds,
      pictureFill: { assetId: 'asset_photo', sourceCrop: { left: 10000 } },
    })).nodes[0]

    if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
    expect(node.pictureFill).toEqual({ assetId: 'asset_photo', metadata: photo, sourceCrop: { left: 10000 } })
    expect(node.path.length).toBeGreaterThan(0)
  })

  it('carries the fill on a text element and gives it a path to clip to', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_text',
      kind: 'text',
      bounds,
      text: 'Filled',
      pictureFill: { assetId: 'asset_photo' },
    })).nodes[0]

    if (node?.kind !== 'text') throw new Error('fixture did not build a text node')
    expect(node.pictureFill).toEqual({ assetId: 'asset_photo', metadata: photo })
    expect(node.path?.length ?? 0).toBeGreaterThan(0)
  })

  /** Decision 4: a transparent PNG must not composite over a colour the file never asked for. */
  it('suppresses the element colour and gradient under a picture fill', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_shape',
      kind: 'shape',
      preset: 'rect',
      bounds,
      fill: {
        color: { type: 'srgb', v: 'FF0000' },
        gradient: {
          stops: [
            { pos: 0, color: { type: 'srgb', v: 'FF0000' } },
            { pos: 100000, color: { type: 'srgb', v: '00FF00' } },
          ],
        },
      },
      pictureFill: { assetId: 'asset_photo' },
    })).nodes[0]

    if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
    expect(node.pictureFill?.assetId).toBe('asset_photo')
    expect(node.resolvedFillColor).toBeUndefined()
    expect(node.resolvedFillGradient).toBeUndefined()
    // The model value still rides along: the writeback compares against it, not against the scene.
    expect(node.fill?.color).toEqual({ type: 'srgb', v: 'FF0000' })
  })

  it('suppresses the style matrix fallback as well, and leaves the outline alone', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_shape',
      kind: 'shape',
      preset: 'rect',
      bounds,
      styleRef: { fill: { idx: 1, color: { type: 'scheme', v: 'accent1' } } },
      stroke: { color: { type: 'srgb', v: '000000' } },
      pictureFill: { assetId: 'asset_photo' },
    })).nodes[0]

    if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
    expect(node.resolvedFillColor).toBeUndefined()
    expect(node.resolvedStrokeColor).toEqual({ rgb: '000000', alpha: 100000 })
  })

  it('keeps the fill without metadata when the asset map has no entry for it', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_shape',
      kind: 'shape',
      preset: 'rect',
      bounds,
      pictureFill: { assetId: 'asset_photo' },
    }, {})).nodes[0]

    if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
    expect(node.pictureFill).toEqual({ assetId: 'asset_photo' })
  })

  it('leaves a shape without a picture fill exactly as it was', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_shape',
      kind: 'shape',
      preset: 'rect',
      bounds,
      fill: { color: { type: 'srgb', v: '4472C4' } },
    })).nodes[0]

    if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
    expect(node.pictureFill).toBeUndefined()
    expect(node.resolvedFillColor).toEqual({ rgb: '4472C4', alpha: 100000 })
  })
})

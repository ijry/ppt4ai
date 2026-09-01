import { describe, expect, it } from 'vitest'
import type { Ppt4aiDocument } from '@ppt4ai/model'
import { documentToSceneGraph } from './scenegraph'

function rotatedDocument(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_rotation',
    page: { w: 10000000, h: 6000000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['shape_r', 'text_r'] } },
    elements: {
      shape_r: { id: 'shape_r', kind: 'shape', preset: 'rect', bounds: { x: 0, y: 0, w: 1000, h: 500 }, rotation: 2700000 },
      text_r: { id: 'text_r', kind: 'text', bounds: { x: 0, y: 0, w: 1000, h: 500 }, rotation: 5400000, text: 'Tilted' },
    },
    slideOrder: ['sld_1'],
  }
}

describe('scene graph rotation gap', () => {
  it('drops shape and text rotation, so the canvas cannot render it', () => {
    const scene = documentToSceneGraph(rotatedDocument())
    const shape = scene.nodes.find((node) => node.id === 'shape_r')
    const text = scene.nodes.find((node) => node.id === 'text_r')

    expect(shape).toBeDefined()
    expect(text).toBeDefined()
    expect(shape).not.toHaveProperty('rotation')
    expect(text).not.toHaveProperty('rotation')
    expect(shape).not.toHaveProperty('transform')
    expect(text).not.toHaveProperty('transform')
  })

  it('still carries image transform through, showing the inconsistency', () => {
    const document = rotatedDocument()
    document.slides.sld_1!.elementIds = ['image_r']
    document.elements = {
      image_r: {
        id: 'image_r',
        kind: 'image',
        bounds: { x: 0, y: 0, w: 100, h: 100 },
        assetId: 'asset_x',
        transform: { rotation: 2700000 },
      },
    }
    document.assets = { asset_x: { id: 'asset_x', mimeType: 'image/png' } }

    const node = documentToSceneGraph(document).nodes.find((entry) => entry.id === 'image_r')

    expect(node).toMatchObject({ transform: { rotation: 2700000 } })
  })
})

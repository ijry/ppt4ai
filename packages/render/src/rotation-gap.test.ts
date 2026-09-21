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

describe('scene graph rotation', () => {
  it('carries shape and text rotation as a transform the canvas can apply', () => {
    const scene = documentToSceneGraph(rotatedDocument())
    const shape = scene.nodes.find((node) => node.id === 'shape_r')
    const text = scene.nodes.find((node) => node.id === 'text_r')

    expect(shape).toMatchObject({ transform: { rotation: 2700000 } })
    expect(text).toMatchObject({ transform: { rotation: 5400000 } })
  })

  it('omits the transform when rotation is zero or absent, keeping existing scenes unchanged', () => {
    const document = rotatedDocument()
    document.elements.shape_r = { id: 'shape_r', kind: 'shape', preset: 'rect', bounds: { x: 0, y: 0, w: 1000, h: 500 }, rotation: 0 }
    document.elements.text_r = { id: 'text_r', kind: 'text', bounds: { x: 0, y: 0, w: 1000, h: 500 }, text: 'Flat' }

    const scene = documentToSceneGraph(document)

    expect(scene.nodes.find((node) => node.id === 'shape_r')).not.toHaveProperty('transform')
    expect(scene.nodes.find((node) => node.id === 'text_r')).not.toHaveProperty('transform')
  })

  it('carries table rotation as a transform, and omits it when unrotated', () => {
    const document = rotatedDocument()
    document.slides.sld_1!.elementIds = ['table_r', 'table_flat']
    const grid = {
      kind: 'table' as const,
      bounds: { x: 0, y: 0, w: 1000, h: 500 },
      columns: [1000],
      rows: [{ height: 500, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'Cell' }] }] } }] }],
    }
    document.elements = {
      table_r: { ...grid, id: 'table_r', rotation: 1200000 },
      table_flat: { ...grid, id: 'table_flat' },
    }

    const scene = documentToSceneGraph(document)

    expect(scene.nodes.find((node) => node.id === 'table_r')).toMatchObject({ transform: { rotation: 1200000 } })
    expect(scene.nodes.find((node) => node.id === 'table_flat')).not.toHaveProperty('transform')
  })

  it('carries image transform through unchanged', () => {
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

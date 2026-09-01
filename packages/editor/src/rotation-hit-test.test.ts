import { describe, expect, it } from 'vitest'
import type { SceneGraph } from '@ppt4ai/render'
import { hitTestScene } from './slide-canvas'

function rotatedImageScene(): SceneGraph {
  return {
    slideId: 'sld_1',
    page: { w: 1000, h: 1000 },
    nodes: [{
      id: 'img_1',
      kind: 'image',
      bounds: { x: 400, y: 450, w: 200, h: 100 },
      assetId: 'asset_x',
      transform: { rotation: 5400000 },
    }],
  } as unknown as SceneGraph
}

describe('hit testing respects rotation', () => {
  it('hits the point the rotated image actually covers', () => {
    const scene = rotatedImageScene()

    expect(hitTestScene(scene, { x: 500, y: 560 })).toBe('img_1')
  })

  it('misses the point left blank by the rotation', () => {
    const scene = rotatedImageScene()

    expect(hitTestScene(scene, { x: 590, y: 500 })).toBeUndefined()
  })

  it('ignores flips, which do not change the covered region', () => {
    const scene = rotatedImageScene()
    const node = scene.nodes[0]!
    if (node.kind !== 'image') throw new Error('fixture changed')
    node.transform = { rotation: 5400000, flipH: true, flipV: true }

    expect(hitTestScene(scene, { x: 500, y: 560 })).toBe('img_1')
    expect(hitTestScene(scene, { x: 590, y: 500 })).toBeUndefined()
  })

  it('leaves unrotated nodes on the axis-aligned path', () => {
    const scene = rotatedImageScene()
    const node = scene.nodes[0]!
    if (node.kind !== 'image') throw new Error('fixture changed')
    delete node.transform

    expect(hitTestScene(scene, { x: 590, y: 500 })).toBe('img_1')
    expect(hitTestScene(scene, { x: 500, y: 560 })).toBeUndefined()
  })
})

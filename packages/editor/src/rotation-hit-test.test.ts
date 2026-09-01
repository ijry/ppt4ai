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

describe('hit testing ignores rotation', () => {
  it('still reports a hit inside the unrotated box after a 90 degree rotation', () => {
    const scene = rotatedImageScene()

    expect(hitTestScene(scene, { x: 590, y: 500 })).toBe('img_1')
  })

  it('misses the point that the rotated image actually covers', () => {
    const scene = rotatedImageScene()

    expect(hitTestScene(scene, { x: 500, y: 560 })).toBeUndefined()
  })
})

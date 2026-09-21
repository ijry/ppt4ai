import type { SceneImageNode } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { paintImageNode } from './image-painting'
import type { DecodedImage } from './image-canvas-renderer'

function context(): CanvasRenderingContext2D & { saves: number; restores: number; draws: unknown[][] } {
  let saves = 0
  let restores = 0
  const draws: unknown[][] = []
  return {
    saves,
    restores,
    draws,
    save: () => { saves += 1 },
    restore: () => { restores += 1 },
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    drawImage: (...args: unknown[]) => { draws.push(args) },
  } as unknown as CanvasRenderingContext2D & { saves: number; restores: number; draws: unknown[][] }
}

describe('shared image painting', () => {
  it('paints a node in explicit pixel bounds', () => {
    const drawingContext = context()
    const node: SceneImageNode = {
      id: 'image-1',
      kind: 'image',
      bounds: { x: 0, y: 0, w: 100, h: 80 },
      assetId: 'asset-1',
    }
    const image: DecodedImage = { source: {} as CanvasImageSource, width: 10, height: 10 }

    paintImageNode(drawingContext, node, image, { x: 20, y: 30, w: 40, h: 50 })

    expect(drawingContext.draws).toHaveLength(1)
  })
})

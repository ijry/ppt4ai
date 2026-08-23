import type { AssetAdapter, AssetMetadata } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { createImageCanvasRenderer, type DecodedImage, type ImageDecoder } from './image-canvas-renderer'

class RecordingAdapter implements AssetAdapter {
  readonly getCalls: string[] = []

  async get(assetId: string): Promise<Uint8Array | undefined> {
    this.getCalls.push(assetId)
    return new Uint8Array([assetId.endsWith('a') ? 1 : 2])
  }

  async put(_assetId: string, _data: Uint8Array, _metadata: AssetMetadata): Promise<void> {}
}

function createScene(): SceneGraph {
  return {
    slideId: 'slide-1',
    page: { w: 9144000, h: 5143500 },
    nodes: [
      { id: 'image-a', kind: 'image', bounds: { x: 100, y: 200, w: 300, h: 400 }, assetId: 'asset-a', metadata: { id: 'asset-a', mimeType: 'image/png' } },
      { id: 'shape-1', kind: 'shape', bounds: { x: 0, y: 0, w: 10, h: 10 }, path: [] },
      { id: 'image-b', kind: 'image', bounds: { x: 500, y: 600, w: 700, h: 800 }, assetId: 'asset-b', metadata: { id: 'asset-b', mimeType: 'image/jpeg' } },
    ],
  }
}

function createRecordingContext(): CanvasRenderingContext2D & {
  draws: Array<{ source: { id: string }; bounds: { x: number; y: number; w: number; h: number } }>
  transforms: number[][]
} {
  const canvas = { width: 0, height: 0, style: { width: '', height: '' } }
  const draws: Array<{ source: { id: string }; bounds: { x: number; y: number; w: number; h: number } }> = []
  const transforms: number[][] = []
  return {
    canvas,
    draws,
    transforms,
    clearRect: () => {},
    drawImage: (source: CanvasImageSource, x: number, y: number, w: number, h: number) => {
      draws.push({ source: source as unknown as { id: string }, bounds: { x, y, w, h } })
    },
    setTransform: (...values: number[]) => { transforms.push(values) },
  } as unknown as CanvasRenderingContext2D & {
    draws: Array<{ source: { id: string }; bounds: { x: number; y: number; w: number; h: number } }>
    transforms: number[][]
  }
}

describe('image canvas renderer', () => {
  it('paints image nodes in scene order with EMU and high-DPI scaling', async () => {
    const adapter = new RecordingAdapter()
    const decoder: ImageDecoder = async (data): Promise<DecodedImage> => ({
      source: { id: data[0] === 1 ? 'decoded-a' : 'decoded-b' } as unknown as CanvasImageSource,
      width: 100,
      height: 100,
    })
    const renderer = createImageCanvasRenderer({ adapter, decoder })
    const context = createRecordingContext()

    const result = await renderer.render(createScene(), context, { zoom: 1.5, devicePixelRatio: 2 })

    expect(context.canvas.width).toBe(Math.round(960 * 1.5 * 2))
    expect(context.canvas.height).toBe(Math.round(540 * 1.5 * 2))
    expect(context.canvas.style).toEqual({ width: '1440px', height: '810px' })
    expect(context.transforms.at(-1)).toEqual([2 * 96 / 914400 * 1.5, 0, 0, 2 * 96 / 914400 * 1.5, 0, 0])
    expect(context.draws.map((draw) => draw.source.id)).toEqual(['decoded-a', 'decoded-b'])
    expect(context.draws.map((draw) => draw.bounds)).toEqual([
      { x: 100, y: 200, w: 300, h: 400 },
      { x: 500, y: 600, w: 700, h: 800 },
    ])
    expect(result).toEqual({ drawnNodeIds: ['image-a', 'image-b'], skippedNodeIds: [], issues: [] })
    expect(structuredClone(result)).toEqual(result)
  })
})

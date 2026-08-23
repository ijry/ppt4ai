import type { AssetAdapter, AssetMetadata } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { createImageCanvasRenderer, type DecodedImage, type ImageDecoder } from './image-canvas-renderer'

class RecordingAdapter implements AssetAdapter {
  readonly getCalls: string[] = []
  readonly assets = new Map<string, Uint8Array | undefined>()

  async get(assetId: string): Promise<Uint8Array | undefined> {
    this.getCalls.push(assetId)
    return this.assets.has(assetId)
      ? this.assets.get(assetId)
      : new Uint8Array([assetId.endsWith('a') ? 1 : 2])
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
  saves: number
  restores: number
  translations: number[][]
  rotations: number[]
  scales: number[][]
  ellipses: number[][]
  clips: number
  drawArgs: unknown[][]
  globalAlpha: number
  filter: string
} {
  const canvas = { width: 0, height: 0, style: { width: '', height: '' } }
  const draws: Array<{ source: { id: string }; bounds: { x: number; y: number; w: number; h: number } }> = []
  const transforms: number[][] = []
  const translations: number[][] = []
  const rotations: number[] = []
  const scales: number[][] = []
  const ellipses: number[][] = []
  const drawArgs: unknown[][] = []
  let saves = 0
  let restores = 0
  let clips = 0
  let globalAlpha = 1
  let filter = 'none'
  return {
    canvas,
    draws,
    transforms,
    get saves() { return saves },
    get restores() { return restores },
    translations,
    rotations,
    scales,
    ellipses,
    get clips() { return clips },
    drawArgs,
    get globalAlpha() { return globalAlpha },
    set globalAlpha(value: number) { globalAlpha = value },
    get filter() { return filter },
    set filter(value: string) { filter = value },
    clearRect: () => {},
    save: () => { saves += 1 },
    restore: () => { restores += 1 },
    translate: (...values: number[]) => { translations.push(values) },
    rotate: (value: number) => { rotations.push(value) },
    scale: (...values: number[]) => { scales.push(values) },
    beginPath: () => {},
    rect: () => {},
    ellipse: (...values: number[]) => { ellipses.push(values) },
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    clip: () => { clips += 1 },
    drawImage: (...args: unknown[]) => {
      drawArgs.push(args)
      const source = args[0] as { id: string }
      const values = args.length === 9 ? args.slice(5) : args.slice(1)
      draws.push({ source, bounds: { x: values[0] as number, y: values[1] as number, w: values[2] as number, h: values[3] as number } })
    },
    setTransform: (...values: number[]) => { transforms.push(values) },
  } as unknown as CanvasRenderingContext2D & {
    draws: Array<{ source: { id: string }; bounds: { x: number; y: number; w: number; h: number } }>
    transforms: number[][]
    saves: number
    restores: number
    translations: number[][]
    rotations: number[]
    scales: number[][]
    ellipses: number[][]
    clips: number
    drawArgs: unknown[][]
    globalAlpha: number
    filter: string
  }
}

function createSceneWithImages(...images: Array<{ id: string; assetId: string; maskPreset?: 'ellipse' }>): SceneGraph {
  return {
    slideId: 'slide-1',
    page: { w: 9144000, h: 5143500 },
    nodes: images.map((image, index) => ({
      id: image.id,
      kind: 'image' as const,
      bounds: { x: index * 100, y: index * 100, w: 100, h: 100 },
      assetId: image.assetId,
      metadata: { id: image.assetId, mimeType: 'image/png' as const },
      ...(image.maskPreset ? { maskPreset: image.maskPreset } : {}),
    })),
  }
}

function createDecoder(sourceByByte = new Map<number, { id: string }>()): ImageDecoder & { calls: number[] } {
  const calls: number[] = []
  const decoder = (async (data: Uint8Array): Promise<DecodedImage> => {
    calls.push(data[0] ?? 0)
    const source = sourceByByte.get(data[0] ?? 0) ?? { id: `decoded-${data[0] ?? 0}` }
    return { source: source as unknown as CanvasImageSource, width: 100, height: 100 }
  }) as ImageDecoder & { calls: number[] }
  decoder.calls = calls
  return decoder
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
      { x: -150, y: -200, w: 300, h: 400 },
      { x: -350, y: -400, w: 700, h: 800 },
    ])
    expect(result).toEqual({ drawnNodeIds: ['image-a', 'image-b'], skippedNodeIds: [], issues: [] })
    expect(structuredClone(result)).toEqual(result)
  })

  it('deduplicates cached assets across duplicate nodes and renders', async () => {
    const adapter = new RecordingAdapter()
    const decoder = createDecoder()
    const renderer = createImageCanvasRenderer({ adapter, decoder })
    const scene = createSceneWithImages(
      { id: 'image-a', assetId: 'asset-shared' },
      { id: 'image-b', assetId: 'asset-shared' },
    )

    const first = await renderer.render(scene, createRecordingContext())
    const second = await renderer.render(scene, createRecordingContext())

    expect(first.drawnNodeIds).toEqual(['image-a', 'image-b'])
    expect(second.drawnNodeIds).toEqual(['image-a', 'image-b'])
    expect(adapter.getCalls).toEqual(['asset-shared'])
    expect(decoder.calls).toHaveLength(1)
  })

  it('paints image appearance using centered transforms, crop, mask, and effects', async () => {
    const adapter = new RecordingAdapter()
    const source = { id: 'appearance-source' }
    const decoder: ImageDecoder = async (): Promise<DecodedImage> => ({ source: source as unknown as CanvasImageSource, width: 200, height: 100 })
    const renderer = createImageCanvasRenderer({ adapter, decoder })
    const context = createRecordingContext()
    const result = await renderer.render({
      slideId: 'slide-1',
      page: { w: 9144000, h: 5143500 },
      nodes: [{
        id: 'image-appearance',
        kind: 'image',
        bounds: { x: 1000, y: 2000, w: 300, h: 400 },
        assetId: 'asset-appearance',
        transform: { rotation: 5400000, flipH: true },
        sourceCrop: { left: 10000, top: 20000, right: 30000, bottom: 10000 },
        maskPreset: 'ellipse',
        effects: [{ type: 'alphaModFix', amount: 50000 }, { type: 'grayscl' }],
      }],
    }, context)

    expect(context.drawArgs).toEqual([[source, 20, 20, 120, 70, -150, -200, 300, 400]])
    expect(context.translations).toEqual([[1150, 2200]])
    expect(context.rotations).toEqual([Math.PI / 2])
    expect(context.scales).toContainEqual([-1, 1])
    expect(context.ellipses).toContainEqual([0, 0, 150, 200, 0, 0, Math.PI * 2])
    expect(context.clips).toBe(1)
    expect(context.globalAlpha).toBe(0.5)
    expect(context.filter).toBe('grayscale(1)')
    expect(context.saves).toBe(1)
    expect(context.restores).toBe(1)
    expect(result.drawnNodeIds).toEqual(['image-appearance'])
  })

  it('restores failed image paint state and continues with following images', async () => {
    const adapter = new RecordingAdapter()
    const decoder: ImageDecoder = async (data): Promise<DecodedImage> => ({
      source: { id: data[0] } as unknown as CanvasImageSource,
      width: 20,
      height: 20,
    })
    const context = createRecordingContext()
    context.clip = (() => { throw new Error('clip rejected') }) as CanvasRenderingContext2D['clip']
    const renderer = createImageCanvasRenderer({ adapter, decoder })

    const result = await renderer.render(createSceneWithImages(
      { id: 'image-failed', assetId: 'asset-failed', maskPreset: 'ellipse' },
      { id: 'image-good', assetId: 'asset-good' },
    ), context)

    expect(result.issues).toEqual([{ nodeId: 'image-failed', assetId: 'asset-failed', code: 'draw-failed', message: 'clip rejected' }])
    expect(result.drawnNodeIds).toEqual(['image-good'])
    expect(context.saves).toBe(2)
    expect(context.restores).toBe(2)
  })

  it('deduplicates in-flight loads across concurrent renders', async () => {
    const adapter = new RecordingAdapter()
    let release: (() => void) | undefined
    const decoder = (async (data: Uint8Array): Promise<DecodedImage> => {
      await new Promise<void>((resolve) => { release = resolve })
      return { source: { id: data[0] } as unknown as CanvasImageSource, width: 1, height: 1 }
    })
    const renderer = createImageCanvasRenderer({ adapter, decoder })
    const scene = createSceneWithImages({ id: 'image-a', assetId: 'asset-shared' })
    const first = renderer.render(scene, createRecordingContext())
    const second = renderer.render(scene, createRecordingContext())
    await Promise.resolve()
    release?.()

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(adapter.getCalls).toEqual(['asset-shared'])
  })

  it('reports per-node load and draw failures without aborting other images', async () => {
    const adapter = new RecordingAdapter()
    adapter.assets.set('asset-missing', undefined)
    adapter.assets.set('asset-bad', new Uint8Array([3]))
    adapter.assets.set('asset-draw', new Uint8Array([4]))
    adapter.assets.set('asset-good', new Uint8Array([5]))
    const decoder: ImageDecoder = async (data) => {
      if (data[0] === 3) throw new Error('bad bitmap')
      return { source: { id: data[0] } as unknown as CanvasImageSource, width: 1, height: 1 }
    }
    const context = createRecordingContext()
    context.drawImage = ((source: CanvasImageSource) => {
      if ((source as unknown as { id: number }).id === 4) throw new Error('draw rejected')
      context.draws.push({ source: source as unknown as { id: string }, bounds: { x: 0, y: 0, w: 1, h: 1 } })
    }) as CanvasRenderingContext2D['drawImage']
    const renderer = createImageCanvasRenderer({ adapter, decoder })

    const result = await renderer.render(createSceneWithImages(
      { id: 'image-missing', assetId: 'asset-missing' },
      { id: 'image-bad', assetId: 'asset-bad' },
      { id: 'image-draw', assetId: 'asset-draw' },
      { id: 'image-good', assetId: 'asset-good' },
    ), context)

    expect(result.issues).toEqual([
      { nodeId: 'image-missing', assetId: 'asset-missing', code: 'missing-asset', message: 'asset not found' },
      { nodeId: 'image-bad', assetId: 'asset-bad', code: 'decode-failed', message: 'bad bitmap' },
      { nodeId: 'image-draw', assetId: 'asset-draw', code: 'draw-failed', message: 'draw rejected' },
    ])
    expect(result.skippedNodeIds).toEqual(['image-missing', 'image-bad', 'image-draw'])
    expect(result.drawnNodeIds).toEqual(['image-good'])
  })

  it('closes decoded resources on cache clear and retries failed entries', async () => {
    const adapter = new RecordingAdapter()
    adapter.assets.set('asset-bad', new Uint8Array([3]))
    let closeCalls = 0
    let decodeCalls = 0
    const decoder: ImageDecoder = async (data) => {
      decodeCalls += 1
      if (data[0] === 3 && decodeCalls === 1) throw new Error('bad bitmap')
      return { source: {} as CanvasImageSource, width: 1, height: 1, close: () => { closeCalls += 1 } }
    }
    const renderer = createImageCanvasRenderer({ adapter, decoder })
    const scene = createSceneWithImages({ id: 'image-a', assetId: 'asset-a' }, { id: 'image-b', assetId: 'asset-bad' })

    await renderer.render(scene, createRecordingContext())
    await renderer.render(scene, createRecordingContext())
    expect(decodeCalls).toBe(2)
    renderer.clearCache()
    expect(closeCalls).toBe(2)
    await renderer.render(scene, createRecordingContext())
    expect(decodeCalls).toBe(4)
  })

  it('disposes resources and rejects later renders', async () => {
    let closeCalls = 0
    const renderer = createImageCanvasRenderer({
      adapter: new RecordingAdapter(),
      decoder: async () => ({ source: {} as CanvasImageSource, width: 1, height: 1, close: () => { closeCalls += 1 } }),
    })
    await renderer.render(createSceneWithImages({ id: 'image-a', assetId: 'asset-a' }), createRecordingContext())
    renderer.dispose()
    expect(closeCalls).toBe(1)
    await expect(renderer.render(createSceneWithImages({ id: 'image-a', assetId: 'asset-a' }), createRecordingContext()))
      .rejects.toThrow('renderer is disposed')
  })

  it('returns an empty result for an already-aborted render', async () => {
    const controller = new AbortController()
    controller.abort()
    const context = createRecordingContext()
    const renderer = createImageCanvasRenderer({ adapter: new RecordingAdapter(), decoder: createDecoder() })

    const result = await renderer.render(createSceneWithImages({ id: 'image-a', assetId: 'asset-a' }), context, { signal: controller.signal })

    expect(result).toEqual({ drawnNodeIds: [], skippedNodeIds: [], issues: [] })
    expect(context.draws).toEqual([])
  })
})

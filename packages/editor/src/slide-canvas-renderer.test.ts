import type { AssetAdapter, AssetMetadata } from '@ppt4ai/model'
import type { SceneGraph, SceneTableLayoutCell } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { createSlideCanvasRenderer, type DecodedImage } from './slide-canvas-renderer'

class RecordingAdapter implements AssetAdapter {
  readonly getCalls: string[] = []

  async get(assetId: string): Promise<Uint8Array | undefined> {
    this.getCalls.push(assetId)
    return new Uint8Array([7])
  }

  async put(_assetId: string, _data: Uint8Array, _metadata: AssetMetadata): Promise<void> {}
}

type DrawingEvent = [string, ...unknown[]]

function createRecordingContext(): CanvasRenderingContext2D & { events: DrawingEvent[]; canvas: HTMLCanvasElement } {
  const events: DrawingEvent[] = []
  const canvas = { width: 0, height: 0, style: { width: '', height: '' } }
  return {
    canvas,
    events,
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    filter: 'none',
    save: () => events.push(['save']),
    restore: () => events.push(['restore']),
    beginPath: () => events.push(['beginPath']),
    closePath: () => events.push(['closePath']),
    moveTo: (...values: number[]) => events.push(['moveTo', ...values]),
    lineTo: (...values: number[]) => events.push(['lineTo', ...values]),
    ellipse: (...values: number[]) => events.push(['ellipse', ...values]),
    rect: (...values: number[]) => events.push(['rect', ...values]),
    roundRect: (...values: unknown[]) => events.push(['roundRect', ...values]),
    fill: () => events.push(['fill']),
    stroke: () => events.push(['stroke']),
    clip: () => events.push(['clip']),
    fillText: (...values: unknown[]) => events.push(['fillText', ...values]),
    drawImage: (...values: unknown[]) => events.push(['drawImage', ...values]),
    translate: (...values: number[]) => events.push(['translate', ...values]),
    rotate: (...values: number[]) => events.push(['rotate', ...values]),
    scale: (...values: number[]) => events.push(['scale', ...values]),
    setLineDash: (...values: number[]) => events.push(['setLineDash', ...values]),
    clearRect: (...values: number[]) => events.push(['clearRect', ...values]),
    fillRect: (...values: number[]) => events.push(['fillRect', ...values]),
    setTransform: (...values: number[]) => events.push(['setTransform', ...values]),
  } as unknown as CanvasRenderingContext2D & { events: DrawingEvent[]; canvas: HTMLCanvasElement }
}

function textNode(): SceneGraph['nodes'][number] {
  return {
    id: 'text-1',
    kind: 'text',
    bounds: { x: 200, y: 200, w: 1000, h: 500 },
    text: 'Text',
    layout: {
      bounds: { x: 200, y: 200, w: 1000, h: 500 },
      fontScale: 100000,
      overflow: false,
      contentBounds: { x: 200, y: 200, w: 1000, h: 500 },
      lines: [{ paragraphIndex: 0, x: 200, y: 200, width: 500, height: 100, runs: [{ text: 'Text', x: 200, width: 500, marks: { fontSize: 12 } }] }],
    },
  }
}

function tableCell(): SceneTableLayoutCell {
  return {
    row: 0,
    column: 0,
    rowSpan: 1,
    colSpan: 1,
    bounds: { x: 1400, y: 200, w: 500, h: 300 },
    body: { paragraphs: [] },
    borders: {},
    textLayout: { bounds: { x: 1400, y: 200, w: 500, h: 300 }, fontScale: 100000, overflow: false, contentBounds: { x: 1400, y: 200, w: 500, h: 300 }, lines: [] },
    resolvedStyle: { borders: {} },
  }
}

function scene(): SceneGraph {
  return {
    slideId: 'slide-1',
    page: { w: 9144000, h: 5143500 },
    nodes: [
      { id: 'shape-1', kind: 'shape', bounds: { x: 0, y: 0, w: 1000, h: 1000 }, path: [{ type: 'move', x: 0, y: 0 }, { type: 'line', x: 1000, y: 1000 }, { type: 'close' }], resolvedFillColor: { rgb: 'FF0000', alpha: 100000 } },
      textNode(),
      { id: 'table-1', kind: 'table', bounds: { x: 1400, y: 200, w: 500, h: 300 }, layout: { bounds: { x: 1400, y: 200, w: 500, h: 300 }, columns: [500], rows: [300], borders: [], cells: [tableCell()] } },
      { id: 'image-1', kind: 'image', bounds: { x: 2100, y: 200, w: 500, h: 300 }, assetId: 'asset-1', metadata: { id: 'asset-1', mimeType: 'image/png' } },
    ],
  }
}

describe('slide canvas renderer', () => {
  it('paints all node kinds in scene order with one high-DPI page transform', async () => {
    const context = createRecordingContext()
    const adapter = new RecordingAdapter()
    const decoder = async (): Promise<DecodedImage> => ({ source: { id: 'image' } as unknown as CanvasImageSource, width: 10, height: 10 })
    const renderer = createSlideCanvasRenderer({ adapter, decoder })

    const result = await renderer.render(scene(), context, { zoom: 1.5, devicePixelRatio: 2 })

    expect(context.canvas.width).toBe(Math.round(960 * 1.5 * 2))
    expect(context.canvas.height).toBe(Math.round(540 * 1.5 * 2))
    expect(context.canvas.style.width).toBe('1440px')
    expect(context.canvas.style.height).toBe('810px')
    expect(context.events.filter(([type]) => type === 'setTransform')[0]).toEqual(['setTransform', 1, 0, 0, 1, 0, 0])
    // The painters already map EMU to CSS pixels, so the transform only carries CSS to device pixels.
    // This used to assert the EMU-to-device value, which applied zoom twice; see slide-canvas-space.test.ts.
    expect(context.events.filter(([type]) => type === 'setTransform')[1]?.[1]).toBe(2)
    expect(context.events.filter(([type]) => ['fill', 'fillText', 'drawImage'].includes(type)).map(([type]) => type)).toEqual(['fill', 'fillText', 'drawImage'])
    expect(result.drawnNodeIds).toEqual(['shape-1', 'text-1', 'table-1', 'image-1'])
    expect(result.skippedNodeIds).toEqual([])
    expect(result.issues).toEqual([])
    expect(adapter.getCalls).toEqual(['asset-1'])
    expect(structuredClone(result)).toEqual(result)
  })

  /** A dark deck must not render on the canvas default; the page fill goes down before any node. */
  it('fills the page with the scene background before drawing nodes', async () => {
    const context = createRecordingContext()
    const renderer = createSlideCanvasRenderer({ adapter: new RecordingAdapter() })
    const withBackground = { ...scene(), nodes: [], background: { rgb: '1F3864', alpha: 100000 } }

    await renderer.render(withBackground, context, { zoom: 1, devicePixelRatio: 1 })

    const fillRect = context.events.find(([type]) => type === 'fillRect')
    expect(fillRect?.slice(0, 3)).toEqual(['fillRect', 0, 0])
    expect(context.fillStyle).toBe('#1F3864')
  })

  it('fills nothing when the scene declares no background', async () => {
    const context = createRecordingContext()
    const renderer = createSlideCanvasRenderer({ adapter: new RecordingAdapter() })

    await renderer.render({ ...scene(), nodes: [] }, context, {})

    expect(context.events.some(([type]) => type === 'fillRect')).toBe(false)
  })

  it('reports a failed node and continues drawing later nodes', async () => {
    const context = createRecordingContext()
    const invalidScene = scene()
    invalidScene.nodes.splice(1, 0, { id: 'bad-shape', kind: 'shape', bounds: { x: 0, y: 0, w: 1, h: 1 }, path: [{ type: 'move', x: Number.NaN, y: 0 }] })
    const renderer = createSlideCanvasRenderer({
      adapter: new RecordingAdapter(),
      decoder: async (): Promise<DecodedImage> => ({ source: {} as CanvasImageSource, width: 10, height: 10 }),
    })

    const result = await renderer.render(invalidScene, context)

    expect(result.skippedNodeIds).toEqual(['bad-shape'])
    expect(result.issues).toEqual([{ nodeId: 'bad-shape', kind: 'shape', code: 'draw-failed', message: 'shape x must be finite' }])
    expect(result.drawnNodeIds).toEqual(['shape-1', 'text-1', 'table-1', 'image-1'])
  })
})

import type { AssetAdapter } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { createSlideCanvasRenderer, type DecodedImage } from './slide-canvas-renderer'

type Event = [string, ...unknown[]]

class RecordingContext {
  readonly events: Event[] = []
  fillStyle: unknown = ''
  strokeStyle = ''
  globalAlpha = 1
  lineWidth = 1
  font = ''
  textAlign: CanvasTextAlign = 'start'
  textBaseline: CanvasTextBaseline = 'alphabetic'
  readonly canvas = { width: 0, height: 0, style: { width: '', height: '' } } as unknown as HTMLCanvasElement

  setTransform(...args: number[]): void { this.events.push(['setTransform', ...args]) }
  clearRect(...args: number[]): void { this.events.push(['clearRect', ...args]) }
  fillRect(...args: number[]): void { this.events.push(['fillRect', ...args]) }
  save(): void {}
  restore(): void {}
  translate(x: number, y: number): void { this.events.push(['translate', x, y]) }
  rotate(): void {}
  scale(): void {}
  beginPath(): void {}
  moveTo(x: number, y: number): void { this.events.push(['moveTo', x, y]) }
  lineTo(x: number, y: number): void { this.events.push(['lineTo', x, y]) }
  ellipse(): void {}
  closePath(): void {}
  setLineDash(): void {}
  fill(): void {}
  stroke(): void {}
  drawImage(...args: unknown[]): void { this.events.push(['drawImage', ...args]) }
}

const adapter: AssetAdapter = {
  get: async () => ({ bytes: new Uint8Array([1]), metadata: { mime: 'image/png', width: 10, height: 10 } }),
} as unknown as AssetAdapter

const decoder = async (): Promise<DecodedImage> => ({
  source: { id: 'image' } as unknown as CanvasImageSource,
  width: 10,
  height: 10,
})

const page = { w: 12192000, h: 6858000 }

function scene(): SceneGraph {
  return {
    slideId: 'sld_1',
    page,
    background: { rgb: '1F3864', alpha: 100000 },
    nodes: [
      {
        id: 'shape-1',
        kind: 'shape',
        bounds: { x: 0, y: 0, w: page.w, h: page.h },
        path: [
          { type: 'move', x: 0, y: 0 },
          { type: 'line', x: page.w, y: page.h },
          { type: 'close' },
        ],
        resolvedFillColor: { rgb: '4472C4', alpha: 100000 },
      },
      {
        id: 'image-1',
        kind: 'image',
        bounds: { x: 0, y: 0, w: page.w, h: page.h },
        assetId: 'asset-1',
      },
    ],
  }
}

async function render(zoom: number, devicePixelRatio: number): Promise<RecordingContext> {
  const context = new RecordingContext()
  const renderer = createSlideCanvasRenderer({ adapter, decoder })
  await renderer.render(scene(), context as unknown as CanvasRenderingContext2D, { zoom, devicePixelRatio })
  return context
}

function lastTransform(context: RecordingContext): number {
  const transforms = context.events.filter(([type]) => type === 'setTransform')
  return transforms.at(-1)?.[1] as number
}

/**
 * These assert where content lands, not what arguments the transform got. The old test asserted the
 * transform value, which is the implementation copied into the test: the transform was wrong and the
 * assertion agreed with it.
 */
describe('slide canvas coordinate space', () => {
  it('draws a full-page shape across the whole canvas', async () => {
    const context = await render(1, 1)

    expect(context.canvas.width).toBe(1280)
    expect(context.canvas.height).toBe(720)
    expect(context.events).toContainEqual(['lineTo', 1280, 720])
  })

  it('fills the background over the whole canvas', async () => {
    const context = await render(1, 1)

    expect(context.events).toContainEqual(['fillRect', 0, 0, 1280, 720])
  })

  /** Content stays in CSS pixels and the transform takes it to the device pixel backing store. */
  it('scales to device pixels through the transform, not through the content', async () => {
    const context = await render(1.5, 2)
    const corner = context.events.filter(([type]) => type === 'lineTo').at(-1)

    expect(context.canvas.width).toBe(Math.round(1280 * 1.5 * 2))
    expect(lastTransform(context)).toBe(2)
    expect(corner?.[1] as number).toBeCloseTo(1920)
    expect(corner?.[2] as number).toBeCloseTo(1080)
  })

  /** Images used to be handed raw EMU while every other node was mapped, a factor of 9525 apart. */
  it('draws an image in the same space as a shape', async () => {
    const context = await render(1, 1)
    const translate = context.events.find(([type]) => type === 'translate')

    expect(translate).toEqual(['translate', 640, 360])
  })

  it('keeps the transform an identity for the clear that precedes it', async () => {
    const context = await render(1, 1)
    const transforms = context.events.filter(([type]) => type === 'setTransform')

    expect(transforms[0]).toEqual(['setTransform', 1, 0, 0, 1, 0, 0])
    expect(transforms).toHaveLength(2)
  })
})

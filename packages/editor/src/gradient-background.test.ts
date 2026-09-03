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
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  ellipse(): void {}
  closePath(): void {}
  setLineDash(): void {}
  fill(): void {}
  stroke(): void {}
  drawImage(): void {}
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient {
    this.events.push(['createLinearGradient', x0, y0, x1, y1])
    return {
      addColorStop: (offset: number, color: string) => {
        this.events.push(['addColorStop', offset, color])
      },
    } as CanvasGradient
  }
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

function scene(withGradient: boolean): SceneGraph {
  return {
    slideId: 'sld_1',
    page,
    background: { rgb: '4472C4', alpha: 100000 },
    ...(withGradient
      ? {
          backgroundGradient: {
            stops: [
              { pos: 0, color: { rgb: '4472C4', alpha: 100000 } },
              { pos: 100000, color: { rgb: '203864', alpha: 100000 } },
            ],
            angle: 5400000,
            scaled: false,
          },
        }
      : {}),
    nodes: [],
  }
}

async function render(sceneGraph: SceneGraph): Promise<RecordingContext> {
  const context = new RecordingContext()
  const renderer = createSlideCanvasRenderer({ adapter, decoder })
  await renderer.render(sceneGraph, context as unknown as CanvasRenderingContext2D, { zoom: 1, devicePixelRatio: 1 })
  return context
}

/**
 * The background gradient goes through the same `gradientAxis` the shape painters use, but over the
 * page box rather than a node's bounds. These assert the axis lands in the mapped CSS pixel space —
 * the same space `fillRect` uses — so a gradient background cannot silently disagree with the fill.
 */
describe('gradient background on the slide canvas', () => {
  it('builds the axis across the page for a 90 degree gradient', async () => {
    const context = await render(scene(true))
    const axis = context.events.find(([type]) => type === 'createLinearGradient')

    // 5400000 sixty-thousandths of a degree is 90, so the axis runs top to bottom of 1280x720.
    // Trig makes exact equality wrong here: cos(90 degrees) is not exactly zero in floating point.
    expect(axis?.[1] as number).toBeCloseTo(640)
    expect(axis?.[2] as number).toBeCloseTo(0)
    expect(axis?.[3] as number).toBeCloseTo(640)
    expect(axis?.[4] as number).toBeCloseTo(720)
  })

  it('converts every stop position to a canvas offset', async () => {
    const context = await render(scene(true))

    expect(context.events.filter(([type]) => type === 'addColorStop')).toEqual([
      ['addColorStop', 0, '#4472C4'],
      ['addColorStop', 1, '#203864'],
    ])
  })

  it('fills the page with the gradient rather than the flat colour', async () => {
    const context = await render(scene(true))

    expect(context.fillStyle).toHaveProperty('addColorStop')
    expect(context.events).toContainEqual(['fillRect', 0, 0, 1280, 720])
  })

  /** The flat fallback stays in place for a solid background, so nothing changes for those decks. */
  it('paints a flat colour when the scene carries no background gradient', async () => {
    const context = await render(scene(false))

    expect(context.events.some(([type]) => type === 'createLinearGradient')).toBe(false)
    expect(context.fillStyle).toBe('#4472C4')
  })
})

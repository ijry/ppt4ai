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
  shadowColor = ''
  shadowBlur = 0
  shadowOffsetX = 0
  shadowOffsetY = 0
  readonly canvas = { width: 0, height: 0, style: { width: '', height: '' } } as unknown as HTMLCanvasElement

  setTransform(...args: number[]): void { this.events.push(['setTransform', ...args]) }
  clearRect(...args: number[]): void { this.events.push(['clearRect', ...args]) }
  fillRect(...args: number[]): void { this.events.push(['fillRect', this.fillStyle, ...args]) }
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
  clip(): void { this.events.push(['clip']) }
  setLineDash(): void {}
  fill(): void {}
  stroke(): void { this.events.push(['stroke', this.strokeStyle]) }
  drawImage(): void {}
  createLinearGradient(): CanvasGradient {
    return { addColorStop: () => {} } as CanvasGradient
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

function scene(withPattern: boolean): SceneGraph {
  return {
    slideId: 'sld_1',
    page,
    background: { rgb: '4472C4', alpha: 100000 },
    ...(withPattern
      ? {
          backgroundPattern: {
            preset: 'pct25' as const,
            foreground: { rgb: '203864', alpha: 100000 },
            background: { rgb: 'FFFFFF', alpha: 100000 },
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
 * A pattern background paints its own two colours over the page box, the same way a shape's
 * `a:pattFill` does. These assert the pattern replaces the flat fill rather than layering under it.
 */
describe('pattern background on the slide canvas', () => {
  it('clips to the page and fills both pattern colours across it', async () => {
    const context = await render(scene(true))
    const fills = context.events.filter(([type]) => type === 'fillRect')

    expect(context.events.some(([type]) => type === 'clip')).toBe(true)
    // The percentage preset paints its background across the page, then its foreground over it.
    expect(fills).toContainEqual(['fillRect', '#FFFFFF', 0, 0, 1280, 720])
    expect(fills).toContainEqual(['fillRect', '#203864', 0, 0, 1280, 720])
  })

  it('paints only the flat colour when the scene carries no pattern', async () => {
    const context = await render(scene(false))

    expect(context.events.some(([type]) => type === 'clip')).toBe(false)
    expect(context.events).toContainEqual(['fillRect', '#4472C4', 0, 0, 1280, 720])
  })
})

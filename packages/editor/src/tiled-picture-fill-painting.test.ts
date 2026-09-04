import type { SceneShapeNode } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import type { DecodedImage } from './image-canvas-renderer'
import { paintShapeNode } from './shape-painting'

type Event = [string, ...unknown[]]

class FakePattern {
  transform: DOMMatrix2DInit | undefined
  setTransform(matrix: DOMMatrix2DInit): void { this.transform = matrix }
}

class RecordingContext {
  readonly events: Event[] = []
  readonly patterns: FakePattern[] = []
  fillStyle: unknown = ''
  strokeStyle: unknown = ''
  globalAlpha = 1
  lineWidth = 1
  lineCap: CanvasLineCap = 'butt'
  lineJoin: CanvasLineJoin = 'miter'
  filter = 'none'
  shadowColor = 'rgba(0, 0, 0, 0)'
  shadowBlur = 0
  shadowOffsetX = 0
  shadowOffsetY = 0

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
  clip(): void { this.events.push(['clip']) }
  fill(): void { this.events.push(['fill', this.fillStyle, this.globalAlpha, this.filter]) }
  stroke(): void { this.events.push(['stroke']) }
  drawImage(...args: unknown[]): void { this.events.push(['drawImage', ...args]) }
  createPattern(source: unknown, repetition: string): FakePattern {
    this.events.push(['createPattern', repetition])
    const pattern = new FakePattern()
    this.patterns.push(pattern)
    return pattern
  }
}

/** 32×16 source pixels, so a tile at 100% is 32 × 9525 EMU wide. */
const image: DecodedImage = { source: { tag: 'bitmap' } as unknown as CanvasImageSource, width: 32, height: 16 }

function node(overrides: Partial<SceneShapeNode> = {}): SceneShapeNode {
  return {
    id: 'shape-1',
    kind: 'shape',
    bounds: { x: 0, y: 0, w: 914400, h: 457200 },
    path: [{ type: 'move', x: 0, y: 0 }, { type: 'line', x: 914400, y: 457200 }, { type: 'close' }],
    pictureFill: { assetId: 'asset_photo', tile: {} },
    ...overrides,
  }
}

/** EMU per CSS pixel, the scale the slide renderer uses at zoom 1. */
const scale = 96 / 914400

function paint(overrides: Partial<SceneShapeNode> = {}): RecordingContext {
  const context = new RecordingContext()
  paintShapeNode(context as unknown as CanvasRenderingContext2D, node(overrides), { scale, offsetX: 0, offsetY: 0 }, image)
  return context
}

describe('tiled picture fill painting', () => {
  it('fills the path with a repeating pattern instead of one stretched copy', () => {
    const context = paint()

    expect(context.events.some(([name]) => name === 'createPattern')).toBe(true)
    expect(context.events.find(([name]) => name === 'createPattern')?.[1]).toBe('repeat')
    expect(context.events.some(([name]) => name === 'drawImage')).toBe(false)
    expect(context.events.some(([name]) => name === 'fill')).toBe(true)
  })

  /** A tile at 100% is the source's natural size: 32 px of source becomes 32 CSS px at zoom 1. */
  it('anchors an untransformed tile at the top left with the natural scale', () => {
    const matrix = paint().patterns[0]?.transform

    expect(matrix?.a).toBeCloseTo(1, 6)
    expect(matrix?.d).toBeCloseTo(1, 6)
    expect(matrix?.e).toBeCloseTo(0, 6)
    expect(matrix?.f).toBeCloseTo(0, 6)
  })

  it('applies sx and sy to the tile size', () => {
    const matrix = paint({ pictureFill: { assetId: 'asset_photo', tile: { scaleX: 50000, scaleY: 200000 } } }).patterns[0]?.transform

    expect(matrix?.a).toBeCloseTo(0.5, 6)
    expect(matrix?.d).toBeCloseTo(2, 6)
  })

  it('adds tx and ty as mapped offsets', () => {
    const matrix = paint({ pictureFill: { assetId: 'asset_photo', tile: { offsetX: 914400, offsetY: -457200 } } }).patterns[0]?.transform

    expect(matrix?.e).toBeCloseTo(96, 6)
    expect(matrix?.f).toBeCloseTo(-48, 6)
  })

  /** `algn` names the corner the grid hangs from: `br` puts the last tile flush with the bottom right. */
  it('anchors the grid to the corner algn names', () => {
    const centre = paint({ pictureFill: { assetId: 'asset_photo', tile: { align: 'ctr' } } }).patterns[0]?.transform
    const bottomRight = paint({ pictureFill: { assetId: 'asset_photo', tile: { align: 'br' } } }).patterns[0]?.transform

    // The box is 96 × 48 CSS px and the tile is 32 × 16, so centring offsets by 32 and 16.
    expect(centre?.e).toBeCloseTo(32, 6)
    expect(centre?.f).toBeCloseTo(16, 6)
    expect(bottomRight?.e).toBeCloseTo(64, 6)
    expect(bottomRight?.f).toBeCloseTo(32, 6)
  })

  /** Mirrored tiles need a pre-composed 2×2 tile, so the word changes nothing on the canvas today. */
  it('paints a flipped tile the same as an unflipped one', () => {
    const flipped = paint({ pictureFill: { assetId: 'asset_photo', tile: { flip: 'xy' } } }).patterns[0]?.transform
    const plain = paint().patterns[0]?.transform

    expect({ a: flipped?.a, d: flipped?.d, e: flipped?.e, f: flipped?.f })
      .toEqual({ a: plain?.a, d: plain?.d, e: plain?.e, f: plain?.f })
  })

  it('applies the blip effects to a tiled and a stretched fill alike', () => {
    const effects = [{ type: 'alphaModFix' as const, amount: 40000 }, { type: 'grayscl' as const }]
    const tiledFill = paint({ pictureFill: { assetId: 'asset_photo', tile: {}, effects } })
    const stretched = paint({ pictureFill: { assetId: 'asset_photo', effects } })

    expect(tiledFill.events.find(([name]) => name === 'fill')?.slice(2)).toEqual([0.4, 'grayscale(1)'])
    expect(stretched.filter).toBe('grayscale(1)')
    expect(stretched.globalAlpha).toBeCloseTo(0.4, 6)
  })
})

import type { ResolvedGradient } from '@ppt4ai/model'
import type { SceneShapeNode } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { paintShapeNode } from './shape-painting'

type Event = [string, ...unknown[]]

class RecordingGradient {
  readonly stops: [number, string][] = []
  constructor(readonly axis: [number, number, number, number]) {}
  addColorStop(offset: number, color: string): void { this.stops.push([offset, color]) }
}

class RecordingContext {
  readonly events: Event[] = []
  readonly gradients: RecordingGradient[] = []
  fillStyle: unknown = ''
  strokeStyle = ''
  globalAlpha = 1
  lineWidth = 1

  save(): void { this.events.push(['save']) }
  restore(): void { this.events.push(['restore']) }
  translate(x: number, y: number): void { this.events.push(['translate', x, y]) }
  rotate(angle: number): void { this.events.push(['rotate', angle]) }
  scale(x: number, y: number): void { this.events.push(['scale', x, y]) }
  beginPath(): void { this.events.push(['beginPath']) }
  moveTo(x: number, y: number): void { this.events.push(['moveTo', x, y]) }
  lineTo(x: number, y: number): void { this.events.push(['lineTo', x, y]) }
  ellipse(...args: number[]): void { this.events.push(['ellipse', ...args]) }
  closePath(): void { this.events.push(['closePath']) }
  setLineDash(pattern: number[]): void { this.events.push(['setLineDash', ...pattern]) }
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): RecordingGradient {
    const gradient = new RecordingGradient([x0, y0, x1, y1])
    this.gradients.push(gradient)
    return gradient
  }
  fill(): void { this.events.push(['fill', this.fillStyle, this.globalAlpha]) }
  stroke(): void { this.events.push(['stroke', this.strokeStyle, this.globalAlpha]) }
}

function context(): RecordingContext {
  return new RecordingContext()
}

const vertical: ResolvedGradient = {
  stops: [
    { pos: 0, color: { rgb: '4472C4', alpha: 100000 } },
    { pos: 100000, color: { rgb: '203864', alpha: 60000 } },
  ],
  angle: 5400000,
}

function node(overrides: Partial<SceneShapeNode> = {}): SceneShapeNode {
  return {
    id: 'shape-1',
    kind: 'shape',
    bounds: { x: 0, y: 0, w: 200, h: 100 },
    path: [
      { type: 'move', x: 0, y: 0 },
      { type: 'line', x: 200, y: 0 },
      { type: 'line', x: 200, y: 100 },
      { type: 'close' },
    ],
    ...overrides,
  }
}

function paint(overrides: Partial<SceneShapeNode>, scale = 1): RecordingContext {
  const drawing = context()
  paintShapeNode(
    drawing as unknown as CanvasRenderingContext2D,
    node(overrides),
    { scale, offsetX: 0, offsetY: 0 },
  )
  return drawing
}

describe('gradient fills on the canvas', () => {
  /** Before this a gradient shape painted nothing, because import dropped the fill entirely. */
  it('fills with a canvas gradient along the mapped axis', () => {
    const drawing = paint({ resolvedFillColor: { rgb: '4472C4', alpha: 100000 }, resolvedFillGradient: vertical })
    const gradient = drawing.gradients[0]

    expect(drawing.gradients).toHaveLength(1)
    expect(gradient?.axis[0]).toBeCloseTo(100)
    expect(gradient?.axis[1]).toBeCloseTo(0)
    expect(gradient?.axis[2]).toBeCloseTo(100)
    expect(gradient?.axis[3]).toBeCloseTo(100)
    expect(drawing.events.find(([type]) => type === 'fill')?.[1]).toBe(gradient)
  })

  /** Model positions are thousandths of a percent; the canvas wants a 0..1 offset. */
  it('converts stop positions and carries per-stop alpha in the colour', () => {
    const drawing = paint({ resolvedFillColor: { rgb: '4472C4', alpha: 100000 }, resolvedFillGradient: vertical })

    expect(drawing.gradients[0]?.stops).toEqual([[0, '#4472C4'], [1, 'rgba(32, 56, 100, 0.6)']])
  })

  /** globalAlpha would multiply every stop, so it stays open and alpha rides on the stops. */
  it('leaves globalAlpha at one for a gradient fill', () => {
    const drawing = paint({ resolvedFillColor: { rgb: '4472C4', alpha: 20000 }, resolvedFillGradient: vertical })

    expect(drawing.events.find(([type]) => type === 'fill')?.[2]).toBe(1)
  })

  it('follows the mapped box when the page is scaled', () => {
    const gradient = paint({ resolvedFillColor: { rgb: '4472C4', alpha: 100000 }, resolvedFillGradient: vertical }, 2).gradients[0]

    expect(gradient?.axis[1]).toBeCloseTo(0)
    expect(gradient?.axis[3]).toBeCloseTo(200)
  })

  it('paints a plain colour when the node carries no gradient', () => {
    const drawing = paint({ resolvedFillColor: { rgb: '4472C4', alpha: 50000 } })

    expect(drawing.gradients).toHaveLength(0)
    expect(drawing.events.find(([type]) => type === 'fill')).toEqual(['fill', '#4472C4', 0.5])
  })

  it('clamps a stop position outside the canvas range', () => {
    const drawing = paint({
      resolvedFillColor: { rgb: '000000', alpha: 100000 },
      resolvedFillGradient: {
        stops: [
          { pos: 0, color: { rgb: '000000', alpha: 100000 } },
          { pos: 100000, color: { rgb: 'FFFFFF', alpha: 100000 } },
        ],
      },
    })

    expect(drawing.gradients[0]?.stops.map(([offset]) => offset)).toEqual([0, 1])
  })
})

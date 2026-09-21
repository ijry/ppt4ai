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
  strokeStyle: unknown = ''
  globalAlpha = 1
  lineWidth = 1

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
  setLineDash(pattern: number[]): void { this.events.push(['setLineDash', ...pattern]) }
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): RecordingGradient {
    const gradient = new RecordingGradient([x0, y0, x1, y1])
    this.gradients.push(gradient)
    return gradient
  }
  fill(): void { this.events.push(['fill', this.fillStyle, this.globalAlpha]) }
  stroke(): void { this.events.push(['stroke', this.strokeStyle, this.globalAlpha, this.lineWidth]) }
}

const horizontal: ResolvedGradient = {
  stops: [
    { pos: 0, color: { rgb: '4472C4', alpha: 100000 } },
    { pos: 100000, color: { rgb: 'ED7D31', alpha: 50000 } },
  ],
  angle: 0,
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

function paint(overrides: Partial<SceneShapeNode>): RecordingContext {
  const context = new RecordingContext()
  paintShapeNode(context as unknown as CanvasRenderingContext2D, node(overrides), { scale: 1, offsetX: 0, offsetY: 0 })
  return context
}

describe('gradient stroke on the canvas', () => {
  /** Before this a blue-to-orange outline painted solid blue, its first stop. */
  it('strokes with a canvas gradient along the shape box', () => {
    const drawing = paint({ resolvedStrokeColor: { rgb: '4472C4', alpha: 100000 }, resolvedStrokeGradient: horizontal })
    const gradient = drawing.gradients[0]

    expect(drawing.gradients).toHaveLength(1)
    // angle 0 runs left to right across the 200-wide box.
    expect(gradient?.axis[0]).toBeCloseTo(0)
    expect(gradient?.axis[1]).toBeCloseTo(50)
    expect(gradient?.axis[2]).toBeCloseTo(200)
    expect(gradient?.axis[3]).toBeCloseTo(50)
    expect(drawing.events.find(([type]) => type === 'stroke')?.[1]).toBe(gradient)
  })

  it('converts stop positions and keeps per-stop alpha in the colour', () => {
    const drawing = paint({ resolvedStrokeColor: { rgb: '4472C4', alpha: 100000 }, resolvedStrokeGradient: horizontal })

    expect(drawing.gradients[0]?.stops).toEqual([[0, '#4472C4'], [1, 'rgba(237, 125, 49, 0.5)']])
  })

  /** globalAlpha would multiply every stop, so it stays open and alpha rides on the stops. */
  it('leaves globalAlpha at one for a gradient outline', () => {
    const drawing = paint({ resolvedStrokeColor: { rgb: '4472C4', alpha: 20000 }, resolvedStrokeGradient: horizontal })

    expect(drawing.events.find(([type]) => type === 'stroke')?.[2]).toBe(1)
  })

  it('still honours the line width and dash pattern', () => {
    const drawing = paint({
      resolvedStrokeColor: { rgb: '4472C4', alpha: 100000 },
      resolvedStrokeGradient: horizontal,
      strokeWidth: 10,
      strokeStyle: 'dash',
    })

    expect(drawing.events.find(([type]) => type === 'stroke')?.[3]).toBe(10)
    expect(drawing.events).toContainEqual(['setLineDash', 40, 30])
  })

  it('paints a plain colour when the node carries no outline gradient', () => {
    const drawing = paint({ resolvedStrokeColor: { rgb: '4472C4', alpha: 50000 } })

    expect(drawing.gradients).toHaveLength(0)
    expect(drawing.events.find(([type]) => type === 'stroke')?.slice(0, 3)).toEqual(['stroke', '#4472C4', 0.5])
  })

  /** Fill and outline gradients coexist, each getting its own canvas gradient. */
  it('builds separate gradients for a gradient fill and a gradient outline', () => {
    const drawing = paint({
      resolvedFillColor: { rgb: '000000', alpha: 100000 },
      resolvedFillGradient: { stops: [{ pos: 0, color: { rgb: '000000', alpha: 100000 } }, { pos: 100000, color: { rgb: 'FFFFFF', alpha: 100000 } }] },
      resolvedStrokeColor: { rgb: '4472C4', alpha: 100000 },
      resolvedStrokeGradient: horizontal,
    })

    expect(drawing.gradients).toHaveLength(2)
    expect(drawing.events.find(([type]) => type === 'fill')?.[1]).toBe(drawing.gradients[0])
    expect(drawing.events.find(([type]) => type === 'stroke')?.[1]).toBe(drawing.gradients[1])
  })
})

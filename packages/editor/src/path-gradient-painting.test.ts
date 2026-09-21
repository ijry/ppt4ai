import type { ResolvedGradient } from '@ppt4ai/model'
import type { SceneShapeNode } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { paintShapeNode } from './shape-painting'

type Event = [string, ...unknown[]]

class RecordingGradient {
  readonly stops: [number, string][] = []
  constructor(readonly shape: 'linear' | 'radial', readonly args: number[]) {}
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
  createLinearGradient(...args: number[]): RecordingGradient {
    const gradient = new RecordingGradient('linear', args)
    this.gradients.push(gradient)
    return gradient
  }
  createRadialGradient(...args: number[]): RecordingGradient {
    const gradient = new RecordingGradient('radial', args)
    this.gradients.push(gradient)
    return gradient
  }
  fill(): void { this.events.push(['fill', this.fillStyle, this.globalAlpha]) }
  stroke(): void { this.events.push(['stroke', this.strokeStyle, this.globalAlpha]) }
}

const centred: ResolvedGradient = {
  stops: [
    { pos: 0, color: { rgb: 'FFFFFF', alpha: 100000 } },
    { pos: 100000, color: { rgb: '4472C4', alpha: 100000 } },
  ],
  path: 'circle',
  fillToRect: { left: 50000, top: 50000, right: 50000, bottom: 50000 },
}

function paint(gradient: ResolvedGradient, scale = 1): RecordingContext {
  const drawing = new RecordingContext()
  const node: SceneShapeNode = {
    id: 'shape-1',
    kind: 'shape',
    bounds: { x: 0, y: 0, w: 200, h: 100 },
    path: [
      { type: 'move', x: 0, y: 0 },
      { type: 'line', x: 200, y: 0 },
      { type: 'line', x: 200, y: 100 },
      { type: 'close' },
    ],
    resolvedFillColor: { rgb: 'FFFFFF', alpha: 100000 },
    resolvedFillGradient: gradient,
  }
  paintShapeNode(drawing as unknown as CanvasRenderingContext2D, node, { scale, offsetX: 0, offsetY: 0 })
  return drawing
}

describe('path gradient painting', () => {
  it('paints a circle centred on the convergence rect, reaching the farthest corner', () => {
    const gradient = paint(centred).gradients[0]

    expect(gradient?.shape).toBe('radial')
    expect(gradient?.args[0]).toBeCloseTo(100)
    expect(gradient?.args[1]).toBeCloseTo(50)
    expect(gradient?.args[2]).toBe(0)
    expect(gradient?.args[5]).toBeCloseTo(Math.hypot(100, 50))
  })

  it('converts the stop positions the same way the linear form does', () => {
    expect(paint(centred).gradients[0]?.stops).toEqual([[0, '#FFFFFF'], [1, '#4472C4']])
  })

  it('follows a convergence rect pinned to one corner', () => {
    const corner = paint({ ...centred, fillToRect: { left: 100000, top: 100000, right: 0, bottom: 0 } }).gradients[0]

    expect(corner?.args[0]).toBeCloseTo(200)
    expect(corner?.args[1]).toBeCloseTo(100)
    expect(corner?.args[5]).toBeCloseTo(Math.hypot(200, 100))
  })

  it('paints the other two path words as the same circle', () => {
    expect(paint({ ...centred, path: 'rect' }).gradients[0]?.shape).toBe('radial')
    expect(paint({ ...centred, path: 'shape' }).gradients[0]?.shape).toBe('radial')
  })

  it('follows the mapped box when the page is scaled', () => {
    const gradient = paint(centred, 2).gradients[0]

    expect(gradient?.args[0]).toBeCloseTo(200)
    expect(gradient?.args[1]).toBeCloseTo(100)
    expect(gradient?.args[5]).toBeCloseTo(Math.hypot(200, 100))
  })

  /** A gradient with no path word still takes the linear route. */
  it('leaves a linear gradient linear', () => {
    const gradient = paint({ stops: centred.stops, angle: 5400000 }).gradients[0]

    expect(gradient?.shape).toBe('linear')
  })
})

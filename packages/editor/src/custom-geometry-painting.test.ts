import type { SceneShapeNode } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { paintShapeNode } from './shape-painting'

type Event = [string, ...unknown[]]

class RecordingContext {
  readonly events: Event[] = []
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
  beginPath(): void { this.events.push(['beginPath']) }
  moveTo(x: number, y: number): void { this.events.push(['moveTo', x, y]) }
  lineTo(x: number, y: number): void { this.events.push(['lineTo', x, y]) }
  bezierCurveTo(...args: number[]): void { this.events.push(['bezierCurveTo', ...args]) }
  quadraticCurveTo(...args: number[]): void { this.events.push(['quadraticCurveTo', ...args]) }
  ellipse(...args: number[]): void { this.events.push(['ellipse', ...args]) }
  closePath(): void { this.events.push(['closePath']) }
  setLineDash(): void {}
  clip(): void {}
  fill(): void { this.events.push(['fill']) }
  stroke(): void { this.events.push(['stroke']) }
}

function paint(path: SceneShapeNode['path']): RecordingContext {
  const context = new RecordingContext()
  const node: SceneShapeNode = {
    id: 'shape-1',
    kind: 'shape',
    bounds: { x: 0, y: 0, w: 200, h: 100 },
    path,
    resolvedFillColor: { rgb: '4472C4', alpha: 100000 },
  }
  paintShapeNode(context as unknown as CanvasRenderingContext2D, node, { scale: 1, offsetX: 0, offsetY: 0 })
  return context
}

/** The two commands `a:custGeom` needs that no preset outline ever produced. */
describe('painting Bézier path commands', () => {
  it('draws a cubic curve with both control points', () => {
    const context = paint([
      { type: 'move', x: 0, y: 0 },
      { type: 'cubic', x1: 10, y1: 20, x2: 30, y2: 40, x: 50, y: 60 },
    ])

    expect(context.events).toContainEqual(['bezierCurveTo', 10, 20, 30, 40, 50, 60])
  })

  it('draws a quadratic curve with its single control point', () => {
    const context = paint([
      { type: 'move', x: 0, y: 0 },
      { type: 'quad', x1: 70, y1: 80, x: 90, y: 100 },
    ])

    expect(context.events).toContainEqual(['quadraticCurveTo', 70, 80, 90, 100])
  })

  it('maps curve coordinates through the page mapping like every other command', () => {
    const context = new RecordingContext()
    const node: SceneShapeNode = {
      id: 'shape-1',
      kind: 'shape',
      bounds: { x: 0, y: 0, w: 200, h: 100 },
      path: [{ type: 'move', x: 0, y: 0 }, { type: 'cubic', x1: 10, y1: 10, x2: 20, y2: 20, x: 30, y: 30 }],
      resolvedFillColor: { rgb: '4472C4', alpha: 100000 },
    }
    paintShapeNode(context as unknown as CanvasRenderingContext2D, node, { scale: 2, offsetX: 5, offsetY: 7 })

    expect(context.events).toContainEqual(['bezierCurveTo', 25, 27, 45, 47, 65, 67])
  })
})

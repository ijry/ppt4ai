import type { SceneShapeNode } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { canvasLineCap, canvasLineJoin, paintShapeNode } from './shape-painting'

type Event = [string, ...unknown[]]

class RecordingContext {
  readonly events: Event[] = []
  fillStyle: unknown = ''
  strokeStyle: unknown = ''
  globalAlpha = 1
  lineWidth = 1
  lineCap: CanvasLineCap = 'butt'
  lineJoin: CanvasLineJoin = 'miter'

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
  stroke(): void { this.events.push(['stroke', this.lineCap, this.lineJoin]) }
}

function node(overrides: Partial<SceneShapeNode> = {}): SceneShapeNode {
  return {
    id: 'shape-1',
    kind: 'shape',
    bounds: { x: 0, y: 0, w: 200, h: 100 },
    path: [{ type: 'move', x: 0, y: 0 }, { type: 'line', x: 200, y: 100 }, { type: 'close' }],
    resolvedStrokeColor: { rgb: '203864', alpha: 100000 },
    ...overrides,
  }
}

function paint(overrides: Partial<SceneShapeNode>): RecordingContext {
  const context = new RecordingContext()
  paintShapeNode(context as unknown as CanvasRenderingContext2D, node(overrides), { scale: 1, offsetX: 0, offsetY: 0 })
  return context
}

describe('OOXML to canvas vocabulary', () => {
  it('maps the three cap words', () => {
    expect(canvasLineCap('flat')).toBe('butt')
    expect(canvasLineCap('rnd')).toBe('round')
    expect(canvasLineCap('sq')).toBe('square')
  })

  it('maps the three corner words', () => {
    expect(canvasLineJoin('round')).toBe('round')
    expect(canvasLineJoin('bevel')).toBe('bevel')
    expect(canvasLineJoin('miter')).toBe('miter')
  })

  /** An absent value is the shared OOXML and canvas default, not a reason to leave the context alone. */
  it('falls back to butt and miter', () => {
    expect(canvasLineCap(undefined)).toBe('butt')
    expect(canvasLineJoin(undefined)).toBe('miter')
  })
})

describe('stroke cap and join on the canvas', () => {
  it('sets both from the node', () => {
    expect(paint({ strokeCap: 'rnd', strokeJoin: 'bevel' }).events[0]).toEqual(['stroke', 'round', 'bevel'])
  })

  /**
   * The reason both are set unconditionally: before this, shape painting never touched them, so a
   * shape inherited whatever the previous element left on the shared context.
   */
  it('resets both when the node carries neither', () => {
    const context = new RecordingContext()
    context.lineCap = 'round'
    context.lineJoin = 'bevel'
    paintShapeNode(context as unknown as CanvasRenderingContext2D, node(), { scale: 1, offsetX: 0, offsetY: 0 })

    expect(context.events[0]).toEqual(['stroke', 'butt', 'miter'])
  })

  it('sets the cap without a join and the join without a cap', () => {
    expect(paint({ strokeCap: 'sq' }).events[0]).toEqual(['stroke', 'square', 'miter'])
    expect(paint({ strokeJoin: 'round' }).events[0]).toEqual(['stroke', 'butt', 'round'])
  })
})

import type { SceneShapeNode } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { paintShapeNode } from './shape-painting'

type Event = [string, ...unknown[]]

class RecordingContext {
  readonly events: Event[] = []
  fillStyle = ''
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
  ellipse(cx: number, cy: number, rx: number, ry: number, rotation: number, start: number, end: number): void {
    this.events.push(['ellipse', cx, cy, rx, ry, rotation, start, end])
  }
  closePath(): void { this.events.push(['closePath']) }
  setLineDash(pattern: number[]): void { this.events.push(['setLineDash', ...pattern]) }
  fill(): void { this.events.push(['fill', this.fillStyle, this.globalAlpha]) }
  stroke(): void { this.events.push(['stroke', this.strokeStyle, this.globalAlpha, this.lineWidth]) }
}

function context(): RecordingContext & CanvasRenderingContext2D {
  return new RecordingContext() as unknown as RecordingContext & CanvasRenderingContext2D
}

function node(overrides: Partial<SceneShapeNode> = {}): SceneShapeNode {
  return {
    id: 'shape-1',
    kind: 'shape',
    bounds: { x: 10, y: 20, w: 100, h: 50 },
    path: [
      { type: 'move', x: 10, y: 20 },
      { type: 'line', x: 110, y: 20 },
      { type: 'arc', cx: 85, cy: 45, rx: 25, ry: 25, start: -Math.PI / 2, end: 0 },
      { type: 'close' },
    ],
    ...overrides,
  }
}

describe('shape painting', () => {
  it('maps path commands and paints resolved fill and stroke', () => {
    const drawingContext = context()

    paintShapeNode(drawingContext, node({
      resolvedFillColor: { rgb: '336699', alpha: 50000 },
      resolvedStrokeColor: { rgb: 'FF0000', alpha: 25000 },
    }), { scale: 2, offsetX: 5, offsetY: 7 })

    expect(drawingContext.events).toContainEqual(['moveTo', 25, 47])
    expect(drawingContext.events).toContainEqual(['lineTo', 225, 47])
    expect(drawingContext.events).toContainEqual(['ellipse', 175, 97, 50, 50, 0, -Math.PI / 2, 0])
    expect(drawingContext.events).toContainEqual(['fill', '#336699', 0.5])
    expect(drawingContext.events).toContainEqual(['stroke', '#FF0000', 0.25, 1])
    expect(drawingContext.events[0]).toEqual(['save'])
    expect(drawingContext.events.at(-1)).toEqual(['restore'])
  })

  it('sets the line width from the node, floored at one pixel', () => {
    const wide = context()
    paintShapeNode(wide, node({ resolvedStrokeColor: { rgb: 'FF0000', alpha: 100000 }, strokeWidth: 76200 }), { scale: 0.001, offsetX: 0, offsetY: 0 })
    expect(wide.events.find(([type]) => type === 'stroke')?.[3]).toBeCloseTo(76.2)

    // At thumbnail scale a real width lands below a pixel, the same floor table borders use.
    const tiny = context()
    paintShapeNode(tiny, node({ resolvedStrokeColor: { rgb: 'FF0000', alpha: 100000 }, strokeWidth: 12700 }), { scale: 0.00001, offsetX: 0, offsetY: 0 })
    expect(tiny.events.find(([type]) => type === 'stroke')?.[3]).toBe(1)
  })

  it('leaves the line width alone when the node carries none', () => {
    const drawingContext = context()

    paintShapeNode(drawingContext, node({ resolvedStrokeColor: { rgb: 'FF0000', alpha: 100000 } }), { scale: 2, offsetX: 0, offsetY: 0 })

    expect(drawingContext.events.find(([type]) => type === 'stroke')?.[3]).toBe(1)
  })

  /** Before this, a dashed outline painted solid: the painter never called setLineDash at all. */
  it('sets the dash pattern from the node, in units of the painted line width', () => {
    const dashed = context()
    paintShapeNode(dashed, node({ resolvedStrokeColor: { rgb: 'FF0000', alpha: 100000 }, strokeWidth: 10000, strokeStyle: 'dash' }), { scale: 0.001, offsetX: 0, offsetY: 0 })
    expect(dashed.events).toContainEqual(['setLineDash', 40, 30])

    const dotted = context()
    paintShapeNode(dotted, node({ resolvedStrokeColor: { rgb: 'FF0000', alpha: 100000 }, strokeWidth: 10000, strokeStyle: 'dot' }), { scale: 0.001, offsetX: 0, offsetY: 0 })
    expect(dotted.events).toContainEqual(['setLineDash', 10, 20])
  })

  /** An empty pattern is an explicit reset: without it a previous element's dashes leak through. */
  it('resets the dash pattern for a solid outline', () => {
    const drawingContext = context()

    paintShapeNode(drawingContext, node({ resolvedStrokeColor: { rgb: 'FF0000', alpha: 100000 }, strokeWidth: 10000 }), { scale: 0.001, offsetX: 0, offsetY: 0 })

    expect(drawingContext.events).toContainEqual(['setLineDash'])
  })

  /** With no width the pattern still needs a basis, and 1 matches the hairline the painter draws. */
  it('scales the dash pattern off one pixel when the node carries no width', () => {
    const drawingContext = context()

    paintShapeNode(drawingContext, node({ resolvedStrokeColor: { rgb: 'FF0000', alpha: 100000 }, strokeStyle: 'dash' }), { scale: 2, offsetX: 0, offsetY: 0 })

    expect(drawingContext.events).toContainEqual(['setLineDash', 4, 3])
  })

  it('paints every supported preset path', () => {
    const paths: SceneShapeNode['path'][] = [
      [
        { type: 'move', x: 0, y: 0 },
        { type: 'line', x: 100, y: 0 },
        { type: 'line', x: 100, y: 50 },
        { type: 'line', x: 0, y: 50 },
        { type: 'close' },
      ],
      [
        { type: 'move', x: 10, y: 0 },
        { type: 'line', x: 90, y: 0 },
        { type: 'arc', cx: 90, cy: 10, rx: 10, ry: 10, start: -Math.PI / 2, end: 0 },
        { type: 'line', x: 100, y: 40 },
        { type: 'arc', cx: 90, cy: 40, rx: 10, ry: 10, start: 0, end: Math.PI / 2 },
        { type: 'line', x: 10, y: 50 },
        { type: 'arc', cx: 10, cy: 40, rx: 10, ry: 10, start: Math.PI / 2, end: Math.PI },
        { type: 'line', x: 0, y: 10 },
        { type: 'arc', cx: 10, cy: 10, rx: 10, ry: 10, start: Math.PI, end: Math.PI * 1.5 },
        { type: 'close' },
      ],
      [
        { type: 'move', x: 100, y: 25 },
        { type: 'arc', cx: 50, cy: 25, rx: 50, ry: 25, start: 0, end: Math.PI / 2 },
        { type: 'arc', cx: 50, cy: 25, rx: 50, ry: 25, start: Math.PI / 2, end: Math.PI },
        { type: 'arc', cx: 50, cy: 25, rx: 50, ry: 25, start: Math.PI, end: Math.PI * 1.5 },
        { type: 'arc', cx: 50, cy: 25, rx: 50, ry: 25, start: Math.PI * 1.5, end: Math.PI * 2 },
        { type: 'close' },
      ],
      [
        { type: 'move', x: 50, y: 0 },
        { type: 'line', x: 100, y: 50 },
        { type: 'line', x: 0, y: 50 },
        { type: 'close' },
      ],
    ]
    for (const path of paths) {
      const drawingContext = context()
      paintShapeNode(drawingContext, node({
        path,
        resolvedFillColor: { rgb: '336699', alpha: 100000 },
      }), { scale: 1, offsetX: 0, offsetY: 0 })
      expect(drawingContext.events.some(([type]) => type === 'fill')).toBe(true)
      expect(drawingContext.events.at(-1)).toEqual(['restore'])
    }
  })

  it('validates a no-paint shape without drawing', () => {
    const drawingContext = context()

    paintShapeNode(drawingContext, node(), { scale: 1, offsetX: 0, offsetY: 0 })

    expect(drawingContext.events).toEqual([
      ['save'],
      ['beginPath'],
      ['moveTo', 10, 20],
      ['lineTo', 110, 20],
      ['ellipse', 85, 45, 25, 25, 0, -Math.PI / 2, 0],
      ['closePath'],
      ['restore'],
    ])
  })

  it.each<[string, Partial<SceneShapeNode>]>([
    ['invalid RGB', { resolvedFillColor: { rgb: 'bad', alpha: 100000 } }],
    ['invalid alpha', { resolvedFillColor: { rgb: '336699', alpha: 100001 } }],
    ['non-finite path', { path: [{ type: 'move', x: Number.NaN, y: 0 }] as SceneShapeNode['path'] }],
  ])('rejects %s and restores context', (_label, overrides) => {
    const drawingContext = context()

    expect(() => paintShapeNode(drawingContext, node(overrides), { scale: 1, offsetX: 0, offsetY: 0 })).toThrow()
    expect(drawingContext.events.at(-1)).toEqual(['restore'])
  })

  it('restores context when Canvas fill fails', () => {
    const drawingContext = context()
    drawingContext.fill = () => { throw new Error('fill failed') }

    expect(() => paintShapeNode(drawingContext, node({
      resolvedFillColor: { rgb: '336699', alpha: 100000 },
    }), { scale: 1, offsetX: 0, offsetY: 0 })).toThrow('fill failed')
    expect(drawingContext.events.at(-1)).toEqual(['restore'])
  })

  it('mirrors the geometry about the mapped centre when flipH is set', () => {
    const drawingContext = context()

    paintShapeNode(drawingContext, node({ transform: { flipH: true } }), { scale: 2, offsetX: 5, offsetY: 7 })

    // Mapped bounds are x 25..225, y 47..147, so the centre is (125, 97).
    expect(drawingContext.events).toContainEqual(['translate', 125, 97])
    expect(drawingContext.events).toContainEqual(['scale', -1, 1])
    expect(drawingContext.events).toContainEqual(['translate', -125, -97])
  })

  it('mirrors both axes and keeps the path coordinates unchanged', () => {
    const drawingContext = context()

    paintShapeNode(drawingContext, node({ transform: { flipH: true, flipV: true } }), { scale: 1, offsetX: 0, offsetY: 0 })

    expect(drawingContext.events).toContainEqual(['scale', -1, -1])
    expect(drawingContext.events).toContainEqual(['moveTo', 10, 20])
  })

  it('rotates before it mirrors', () => {
    const drawingContext = context()

    paintShapeNode(drawingContext, node({ transform: { rotation: 5400000, flipV: true } }), { scale: 1, offsetX: 0, offsetY: 0 })

    const rotateIndex = drawingContext.events.findIndex(([type]) => type === 'rotate')
    const scaleIndex = drawingContext.events.findIndex(([type]) => type === 'scale')
    expect(rotateIndex).toBeGreaterThan(-1)
    expect(scaleIndex).toBeGreaterThan(rotateIndex)
  })

  it('leaves the transform alone when no flip is set', () => {
    const drawingContext = context()

    paintShapeNode(drawingContext, node(), { scale: 1, offsetX: 0, offsetY: 0 })

    expect(drawingContext.events.some(([type]) => type === 'scale')).toBe(false)
  })
})

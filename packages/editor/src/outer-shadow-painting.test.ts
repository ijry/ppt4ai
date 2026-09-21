import type { SceneShapeNode, SceneTextNode } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { paintShapeNode } from './shape-painting'
import { paintTextNode } from './text-painting'

type Event = [string, ...unknown[]]

/** Records the shadow state at each paint call, which is the only way to see "one shadow, not two". */
class RecordingContext {
  readonly events: Event[] = []
  fillStyle: unknown = ''
  strokeStyle: unknown = ''
  globalAlpha = 1
  lineWidth = 1
  lineCap: CanvasLineCap = 'butt'
  lineJoin: CanvasLineJoin = 'miter'
  font = ''
  textAlign = 'left'
  textBaseline = 'alphabetic'
  shadowColor = 'rgba(0, 0, 0, 0)'
  shadowBlur = 0
  shadowOffsetX = 0
  shadowOffsetY = 0

  private shadow(): Record<string, unknown> {
    return {
      color: this.shadowColor,
      blur: this.shadowBlur,
      x: Math.round(this.shadowOffsetX),
      y: Math.round(this.shadowOffsetY),
    }
  }

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
  clip(): void {}
  fill(): void { this.events.push(['fill', this.shadow()]) }
  stroke(): void { this.events.push(['stroke', this.shadow()]) }
  fillText(): void { this.events.push(['fillText', this.shadow()]) }
  measureText(): { width: number } { return { width: 10 } }
  drawImage(): void { this.events.push(['drawImage', this.shadow()]) }
}

const shadow = { color: { rgb: '000000', alpha: 40000 }, blurRadius: 50800, distance: 38100, direction: 0 }

function shapeNode(overrides: Partial<SceneShapeNode> = {}): SceneShapeNode {
  return {
    id: 'shape-1',
    kind: 'shape',
    bounds: { x: 0, y: 0, w: 200, h: 100 },
    path: [{ type: 'move', x: 0, y: 0 }, { type: 'line', x: 200, y: 100 }, { type: 'close' }],
    resolvedFillColor: { rgb: '4472C4', alpha: 100000 },
    ...overrides,
  }
}

function paint(node: SceneShapeNode, scale = 1): RecordingContext {
  const context = new RecordingContext()
  paintShapeNode(context as unknown as CanvasRenderingContext2D, node, { scale, offsetX: 0, offsetY: 0 })
  return context
}

describe('outer shadow painting', () => {
  it('sets the colour, blur and offsets from the node', () => {
    const context = paint(shapeNode({ shadow }))

    expect(context.events[0]).toEqual(['fill', { color: 'rgba(0, 0, 0, 0.4)', blur: 50800, x: 38100, y: 0 }])
  })

  it('scales blur and offsets with the page mapping', () => {
    const context = paint(shapeNode({ shadow }), 0.001)

    const state = context.events[0]?.[1] as { blur: number; x: number; y: number; color: string }
    expect(state.blur).toBeCloseTo(50.8, 6)
    expect(state).toMatchObject({ color: 'rgba(0, 0, 0, 0.4)', x: 38, y: 0 })
  })

  /** `dir` is `a:lin/@ang`'s unit: 5400000 is a quarter turn clockwise, so the offset goes down. */
  it('turns the direction into an offset', () => {
    const context = paint(shapeNode({ shadow: { ...shadow, direction: 5400000 } }))

    expect(context.events[0]?.[1]).toMatchObject({ x: 0, y: 38100 })
  })

  /**
   * One shadow per shape, not one per paint call: the stroke's own shadow would show through a
   * translucent fill, and PowerPoint casts a single shadow of the whole shape.
   */
  it('casts the shadow once and clears it for the outline', () => {
    const context = paint(shapeNode({ shadow, resolvedStrokeColor: { rgb: '203864', alpha: 100000 } }))

    expect(context.events.map(([name]) => name)).toEqual(['fill', 'stroke'])
    expect(context.events[0]?.[1]).toMatchObject({ blur: 50800 })
    expect(context.events[1]?.[1]).toEqual({ color: 'rgba(0, 0, 0, 0)', blur: 0, x: 0, y: 0 })
  })

  it('gives the shadow to the outline when there is no fill', () => {
    const node = shapeNode({ shadow, resolvedStrokeColor: { rgb: '203864', alpha: 100000 } })
    delete node.resolvedFillColor

    const context = paint(node)

    expect(context.events.map(([name]) => name)).toEqual(['stroke'])
    expect(context.events[0]?.[1]).toMatchObject({ blur: 50800 })
  })

  /** Same reason `lineCap` is set unconditionally: the previous element's shadow would leak in. */
  it('clears a shadow left on the context when the node has none', () => {
    const context = new RecordingContext()
    context.shadowColor = 'rgba(255, 0, 0, 1)'
    context.shadowBlur = 12
    paintShapeNode(context as unknown as CanvasRenderingContext2D, shapeNode(), { scale: 1, offsetX: 0, offsetY: 0 })

    expect(context.events[0]).toEqual(['fill', { color: 'rgba(0, 0, 0, 0)', blur: 0, x: 0, y: 0 }])
  })

  /** A shape's shadow describes the shape; the text inside it has its own effects, unmodeled. */
  it('does not put the shape shadow behind its text', () => {
    const node: SceneTextNode = {
      id: 'text-1',
      kind: 'text',
      bounds: { x: 0, y: 0, w: 200, h: 100 },
      text: 'Titled',
      layout: {
        bounds: { x: 0, y: 0, w: 200, h: 100 },
        fontScale: 100000,
        overflow: false,
        contentBounds: { x: 0, y: 0, w: 200, h: 100 },
        lines: [{ paragraphIndex: 0, x: 0, y: 0, width: 200, height: 20, runs: [{ text: 'Titled', x: 0, width: 200, marks: { fontSize: 12 } }] }],
      },
      path: [{ type: 'move', x: 0, y: 0 }, { type: 'line', x: 200, y: 100 }, { type: 'close' }],
      resolvedFillColor: { rgb: '4472C4', alpha: 100000 },
      shadow,
    }
    const context = new RecordingContext()
    paintTextNode(context as unknown as CanvasRenderingContext2D, node, { scale: 1, offsetX: 0, offsetY: 0 })

    expect(context.events.map(([name]) => name)).toEqual(['fill', 'fillText'])
    expect(context.events[0]?.[1]).toMatchObject({ blur: 50800 })
    expect(context.events[1]?.[1]).toEqual({ color: 'rgba(0, 0, 0, 0)', blur: 0, x: 0, y: 0 })
  })
})

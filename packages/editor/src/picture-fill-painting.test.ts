import type { SceneShapeNode, SceneTextNode } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import type { DecodedImage } from './image-canvas-renderer'
import { paintShapeNode } from './shape-painting'
import { paintTextNode } from './text-painting'

type Event = [string, ...unknown[]]

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
  filter = 'none'

  save(): void { this.events.push(['save']) }
  restore(): void { this.events.push(['restore']) }
  translate(): void {}
  rotate(): void {}
  scale(x: number, y: number): void { this.events.push(['scale', x, y]) }
  beginPath(): void { this.events.push(['beginPath']) }
  moveTo(x: number, y: number): void { this.events.push(['moveTo', x, y]) }
  lineTo(x: number, y: number): void { this.events.push(['lineTo', x, y]) }
  ellipse(): void {}
  closePath(): void {}
  setLineDash(): void {}
  clip(): void { this.events.push(['clip']) }
  fill(): void { this.events.push(['fill', this.fillStyle, this.globalAlpha]) }
  stroke(): void { this.events.push(['stroke', this.strokeStyle]) }
  fillText(): void {}
  measureText(): { width: number } { return { width: 10 } }
  drawImage(...args: unknown[]): void { this.events.push(['drawImage', ...args]) }
}

const image: DecodedImage = { source: { tag: 'bitmap' } as unknown as CanvasImageSource, width: 400, height: 200 }

function shapeNode(overrides: Partial<SceneShapeNode> = {}): SceneShapeNode {
  return {
    id: 'shape-1',
    kind: 'shape',
    bounds: { x: 100, y: 50, w: 200, h: 100 },
    path: [{ type: 'move', x: 100, y: 50 }, { type: 'line', x: 300, y: 150 }, { type: 'close' }],
    pictureFill: { assetId: 'asset_photo' },
    ...overrides,
  }
}

/** `picture` is passed positionally on purpose: a default would swallow an explicit `undefined`. */
function paintShape(overrides: Partial<SceneShapeNode>, picture?: DecodedImage): RecordingContext {
  const context = new RecordingContext()
  paintShapeNode(context as unknown as CanvasRenderingContext2D, shapeNode(overrides), { scale: 1, offsetX: 0, offsetY: 0 }, picture)
  return context
}

function names(context: RecordingContext): string[] {
  return context.events.map((event) => String(event[0]))
}

function drawCall(context: RecordingContext): Event | undefined {
  return context.events.find((event) => event[0] === 'drawImage')
}

describe('picture fill painting', () => {
  it('clips to the shape path, then stretches the picture across its box', () => {
    const context = paintShape({}, image)

    expect(names(context)).toContain('clip')
    expect(drawCall(context)).toEqual(['drawImage', image.source, 100, 50, 200, 100])
    // The clip is scoped: the save/restore around it is what keeps the stroke drawn next unclipped.
    expect(names(context).filter((name) => name === 'save').length).toBeGreaterThan(1)
  })

  it('scales the target box with the page mapping', () => {
    const context = new RecordingContext()
    paintShapeNode(context as unknown as CanvasRenderingContext2D, shapeNode(), { scale: 2, offsetX: 10, offsetY: 20 }, image)

    expect(drawCall(context)).toEqual(['drawImage', image.source, 210, 120, 400, 200])
  })

  /** `a:srcRect` trims the source, so the nine-argument form carries the trimmed rectangle. */
  it('passes the cropped source rectangle', () => {
    const context = paintShape({ pictureFill: { assetId: 'asset_photo', sourceCrop: { left: 25000, top: 50000 } } }, image)

    expect(drawCall(context)).toEqual(['drawImage', image.source, 100, 100, 300, 100, 100, 50, 200, 100])
  })

  it('paints no fill when the media never arrived', () => {
    const context = paintShape({})

    expect(names(context)).not.toContain('drawImage')
    expect(names(context)).not.toContain('clip')
  })

  it('still paints the outline when the media never arrived', () => {
    const context = paintShape({ resolvedStrokeColor: { rgb: '203864', alpha: 100000 } })

    expect(names(context)).toContain('stroke')
  })

  it('mirrors the picture with the geometry it fills', () => {
    const context = paintShape({ transform: { flipH: true } }, image)

    expect(context.events.find((event) => event[0] === 'scale')).toEqual(['scale', -1, 1])
    expect(drawCall(context)).toBeDefined()
  })

  it('leaves a shape with no picture fill exactly as it was', () => {
    const context = paintShape({ pictureFill: undefined, resolvedFillColor: { rgb: '4472C4', alpha: 100000 } }, image)

    expect(names(context)).not.toContain('drawImage')
    expect(context.events.find((event) => event[0] === 'fill')).toEqual(['fill', '#4472C4', 1])
  })

  /**
   * A hand-built document can carry both; the picture goes down last so it wins on the canvas, which
   * is the precedence the scene graph already encodes by suppressing the resolved colour.
   */
  it('paints the picture over a colour fill when a document carries both', () => {
    const context = paintShape({ resolvedFillColor: { rgb: '4472C4', alpha: 100000 } }, image)
    const order = names(context)

    expect(order.indexOf('fill')).toBeLessThan(order.indexOf('drawImage'))
  })

  it('paints a text element picture fill through the shared path filler', () => {
    const node: SceneTextNode = {
      id: 'text-1',
      kind: 'text',
      bounds: { x: 100, y: 50, w: 200, h: 100 },
      text: '',
      layout: { bounds: { x: 100, y: 50, w: 200, h: 100 }, fontScale: 100000, overflow: false, contentBounds: { x: 100, y: 50, w: 200, h: 100 }, lines: [] },
      path: [{ type: 'move', x: 100, y: 50 }, { type: 'line', x: 300, y: 150 }, { type: 'close' }],
      pictureFill: { assetId: 'asset_photo' },
    }
    const context = new RecordingContext()
    paintTextNode(context as unknown as CanvasRenderingContext2D, node, { scale: 1, offsetX: 0, offsetY: 0 }, image)

    expect(drawCall(context)).toEqual(['drawImage', image.source, 100, 50, 200, 100])
  })
})

import type { SceneShapeNode } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import type { DecodedImage } from './image-canvas-renderer'
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
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  ellipse(): void {}
  closePath(): void {}
  setLineDash(): void {}
  clip(): void {}
  fill(): void { this.events.push(['fill']) }
  stroke(): void { this.events.push(['stroke']) }
  drawImage(...args: unknown[]): void { this.events.push(['drawImage', ...args]) }
}

const image: DecodedImage = { source: { tag: 'bitmap' } as unknown as CanvasImageSource, width: 40, height: 20 }

function paint(stretch: SceneShapeNode['pictureFill'] extends undefined ? never : NonNullable<SceneShapeNode['pictureFill']>['stretch']): RecordingContext {
  const context = new RecordingContext()
  const node: SceneShapeNode = {
    id: 'shape-1',
    kind: 'shape',
    bounds: { x: 100, y: 50, w: 200, h: 100 },
    path: [{ type: 'move', x: 100, y: 50 }, { type: 'line', x: 300, y: 150 }, { type: 'close' }],
    pictureFill: { assetId: 'asset_photo', ...(stretch ? { stretch } : {}) },
  }
  paintShapeNode(context as unknown as CanvasRenderingContext2D, node, { scale: 1, offsetX: 0, offsetY: 0 }, image)
  return context
}

function drawCall(context: RecordingContext): Event | undefined {
  return context.events.find((event) => event[0] === 'drawImage')
}

/** `a:fillRect` was dropped before this, so every stretched picture framed itself to the whole box. */
describe('painting the stretch rect', () => {
  it('draws across the whole box when there is no stretch rect', () => {
    expect(drawCall(paint(undefined))).toEqual(['drawImage', image.source, 100, 50, 200, 100])
  })

  it('insets the target box by each positive side', () => {
    // 10% off the left and 20% off the bottom of a 200×100 box.
    expect(drawCall(paint({ left: 10000, bottom: 20000 }))).toEqual(['drawImage', image.source, 120, 50, 180, 80])
  })

  it('outsets the target box for negative sides', () => {
    const call = drawCall(paint({ left: -10000, right: -10000 }))

    expect(call?.slice(0, 4)).toEqual(['drawImage', image.source, 80, 50])
    // 200 × (1 + 0.1 + 0.1) in floating point, so the width is compared with a tolerance.
    expect(call?.[4] as number).toBeCloseTo(240, 6)
    expect(call?.[5]).toBe(100)
  })

  /** Insets that meet describe an empty target box, which is nothing to paint rather than a mirror. */
  it('paints nothing when the insets leave no box', () => {
    expect(drawCall(paint({ left: 60000, right: 60000 }))).toBeUndefined()
  })
})

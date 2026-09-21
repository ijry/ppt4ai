import type { SceneTextNode } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { paintTextNode } from './text-painting'

type Event = [string, ...unknown[]]

class RecordingContext {
  readonly events: Event[] = []
  font = ''
  textAlign: CanvasTextAlign = 'start'
  textBaseline: CanvasTextBaseline = 'alphabetic'
  fillStyle: unknown = ''
  strokeStyle = ''
  globalAlpha = 1
  lineWidth = 1

  save(): void {}
  restore(): void {}
  fillText(text: string, x: number, y: number): void { this.events.push(['fillText', text, x, y, this.fillStyle]) }
  fillRect(): void {}
  beginPath(): void {}
  closePath(): void {}
  setLineDash(): void {}
  fill(): void {}
  ellipse(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient {
    this.events.push(['createLinearGradient', x0, y0, x1, y1])
    return { addColorStop: (offset: number, color: string) => { this.events.push(['addColorStop', offset, color]) } } as CanvasGradient
  }
}

function context(): RecordingContext & CanvasRenderingContext2D {
  return new RecordingContext() as unknown as RecordingContext & CanvasRenderingContext2D
}

const gradient = {
  stops: [{ pos: 0, color: { rgb: '4472C4', alpha: 100000 } }, { pos: 100000, color: { rgb: '203864', alpha: 100000 } }],
  angle: 5400000,
}

function verticalNode(orientation: 'upright' | 'rotated'): SceneTextNode {
  return {
    id: 'text-1',
    kind: 'text',
    bounds: { x: 0, y: 0, w: 500, h: 1000 },
    text: 'A',
    layout: {
      bounds: { x: 0, y: 0, w: 500, h: 1000 },
      fontScale: 100000,
      overflow: false,
      contentBounds: { x: 0, y: 0, w: 500, h: 1000 },
      vertical: 'vertical',
      lines: [{
        paragraphIndex: 0,
        x: 100,
        y: 100,
        width: 80,
        height: 1000,
        runs: [{
          text: 'A',
          x: 100,
          y: 100,
          width: 80,
          height: 80,
          orientation,
          marks: { fontSize: 20 },
          resolvedColor: { rgb: '4472C4', alpha: 100000 },
          resolvedFillGradient: gradient,
        }],
      }],
    },
  }
}

const mapping = { scale: 1, offsetX: 0, offsetY: 0 }

describe('vertical text gradient painting', () => {
  it('fills an upright vertical glyph with a gradient over its box', () => {
    const ctx = context()
    paintTextNode(ctx, verticalNode('upright'), mapping)

    expect(ctx.events.some(([type]) => type === 'createLinearGradient')).toBe(true)
    const glyph = ctx.events.find(([type]) => type === 'fillText')
    expect((glyph?.[4] as { addColorStop?: unknown }).addColorStop).toBeDefined()
  })

  it('leaves a rotated vertical glyph flat (documented limit)', () => {
    const ctx = context()
    paintTextNode(ctx, verticalNode('rotated'), mapping)

    expect(ctx.events.some(([type]) => type === 'createLinearGradient')).toBe(false)
    const glyph = ctx.events.find(([type]) => type === 'fillText')
    expect(glyph?.[4]).toBe('#4472C4')
  })
})

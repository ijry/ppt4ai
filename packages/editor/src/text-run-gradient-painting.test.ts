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

function node(runGradient?: SceneTextNode['layout']['lines'][number]['runs'][number]['resolvedFillGradient']): SceneTextNode {
  return {
    id: 'text-1',
    kind: 'text',
    bounds: { x: 0, y: 0, w: 1000, h: 500 },
    text: 'Hi',
    layout: {
      bounds: { x: 0, y: 0, w: 1000, h: 500 },
      fontScale: 100000,
      overflow: false,
      contentBounds: { x: 0, y: 0, w: 1000, h: 500 },
      lines: [{
        paragraphIndex: 0,
        x: 100,
        y: 200,
        width: 300,
        height: 100,
        runs: [{
          text: 'Hi',
          x: 100,
          width: 300,
          marks: { fontSize: 20 },
          resolvedColor: { rgb: '4472C4', alpha: 100000 },
          ...(runGradient ? { resolvedFillGradient: runGradient } : {}),
        }],
      }],
    },
  }
}

const mapping = { scale: 1, offsetX: 0, offsetY: 0 }

describe('text run gradient painting', () => {
  it('fills the glyphs with a gradient over the run box', () => {
    const ctx = context()
    paintTextNode(ctx, node({
      stops: [{ pos: 0, color: { rgb: '4472C4', alpha: 100000 } }, { pos: 100000, color: { rgb: '203864', alpha: 100000 } }],
      angle: 5400000,
    }), mapping)

    // 90deg over the 300x100 run box runs top to bottom of the box.
    const axis = ctx.events.find(([type]) => type === 'createLinearGradient')
    expect(axis?.[4] as number).toBeGreaterThan(axis?.[2] as number)
    expect(ctx.events).toContainEqual(['addColorStop', 0, '#4472C4'])
    expect(ctx.events).toContainEqual(['addColorStop', 1, '#203864'])
    const glyph = ctx.events.find(([type]) => type === 'fillText')
    expect((glyph?.[4] as { addColorStop?: unknown }).addColorStop).toBeDefined()
  })

  it('fills flat colour when the run has no gradient', () => {
    const ctx = context()
    paintTextNode(ctx, node(), mapping)

    expect(ctx.events.some(([type]) => type === 'createLinearGradient')).toBe(false)
    const glyph = ctx.events.find(([type]) => type === 'fillText')
    expect(glyph?.[4]).toBe('#4472C4')
  })
})

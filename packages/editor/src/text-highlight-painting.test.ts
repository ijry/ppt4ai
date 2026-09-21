import type { SceneTextNode } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { paintTextNode } from './text-painting'

type Event = [string, ...unknown[]]

class RecordingContext {
  readonly events: Event[] = []
  font = ''
  textAlign: CanvasTextAlign = 'start'
  textBaseline: CanvasTextBaseline = 'alphabetic'
  fillStyle = ''
  strokeStyle = ''
  globalAlpha = 1
  lineWidth = 1

  save(): void {}
  restore(): void {}
  fillText(text: string, x: number, y: number): void { this.events.push(['fillText', text, x, y, this.fillStyle]) }
  fillRect(x: number, y: number, w: number, h: number): void { this.events.push(['fillRect', this.fillStyle, this.globalAlpha, x, y, w, h]) }
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
}

function context(): RecordingContext & CanvasRenderingContext2D {
  return new RecordingContext() as unknown as RecordingContext & CanvasRenderingContext2D
}

function node(highlight?: { rgb: string; alpha: number }): SceneTextNode {
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
          resolvedColor: { rgb: '000000', alpha: 100000 },
          ...(highlight ? { resolvedHighlight: highlight } : {}),
        }],
      }],
    },
  }
}

const mapping = { scale: 1, offsetX: 0, offsetY: 0 }

describe('text highlight painting', () => {
  it('fills the run box with the highlight before the glyphs, at the line height', () => {
    const ctx = context()
    paintTextNode(ctx, node({ rgb: 'FFFF00', alpha: 100000 }), mapping)

    const fillRect = ctx.events.find(([type]) => type === 'fillRect')
    const glyphIndex = ctx.events.findIndex(([type]) => type === 'fillText')
    const rectIndex = ctx.events.findIndex(([type]) => type === 'fillRect')

    expect(fillRect).toEqual(['fillRect', '#FFFF00', 1, 100, 200, 300, 100])
    expect(rectIndex).toBeLessThan(glyphIndex)
  })

  it('paints no highlight rect when the run has none', () => {
    const ctx = context()
    paintTextNode(ctx, node(), mapping)

    expect(ctx.events.some(([type]) => type === 'fillRect')).toBe(false)
  })
})

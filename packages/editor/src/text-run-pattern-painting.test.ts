import { describe, expect, it } from 'vitest'
import type { Ppt4aiDocument, TextMarks } from '@ppt4ai/model'
import { documentToSceneGraph } from '@ppt4ai/render'
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
  fillText(text: string, x: number, y: number): void { this.events.push(['fillText', text, x, y, this.fillStyle, this.globalAlpha]) }
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
  createLinearGradient(): CanvasGradient { this.events.push(['createLinearGradient']); return { addColorStop: () => {} } as CanvasGradient }
}

function context(): RecordingContext & CanvasRenderingContext2D {
  return new RecordingContext() as unknown as RecordingContext & CanvasRenderingContext2D
}

function textNode(marks: TextMarks) {
  const doc: Ppt4aiDocument = {
    format: 'ppt4ai', version: 1, id: 'd', page: { w: 12192000, h: 6858000 },
    slides: { s: { id: 's', elementIds: ['t'] } }, slideOrder: ['s'],
    elements: { t: { id: 't', kind: 'text', bounds: { x: 0, y: 0, w: 4000000, h: 1000000 }, body: { paragraphs: [{ runs: [{ text: 'Hi', marks }] }] } } },
  }
  const node = documentToSceneGraph(doc).nodes[0]
  if (node?.kind !== 'text') throw new Error('not text')
  return node
}

const mapping = { scale: 1, offsetX: 0, offsetY: 0 }

describe('text run pattern painting', () => {
  it('fills a percentage-pattern run with its composite colour', () => {
    const ctx = context()
    const node = textNode({ color: { color: { type: 'srgb', v: 'FF0000' }, pattern: { preset: 'pct50', foreground: { type: 'srgb', v: 'FF0000' }, background: { type: 'srgb', v: '000000' } } } })
    paintTextNode(ctx, node, mapping)

    const glyph = ctx.events.find(([type]) => type === 'fillText')
    // pct50 composites FF0000 over 000000 at half coverage -> around #800000.
    expect(glyph?.[4]).toMatch(/^#[0-9A-F]{6}$/)
    expect(glyph?.[4]).not.toBe('#FF0000')
    expect(ctx.events.some(([type]) => type === 'createLinearGradient')).toBe(false)
  })

  it('leaves a line-preset pattern run at the flat foreground', () => {
    const ctx = context()
    const node = textNode({ color: { color: { type: 'srgb', v: 'FF0000' }, pattern: { preset: 'ltHorz', foreground: { type: 'srgb', v: 'FF0000' }, background: { type: 'srgb', v: '000000' } } } })
    paintTextNode(ctx, node, mapping)

    const glyph = ctx.events.find(([type]) => type === 'fillText')
    expect(glyph?.[4]).toBe('#FF0000')
  })
})

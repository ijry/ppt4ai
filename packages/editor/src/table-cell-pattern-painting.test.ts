import type { SceneTableLayoutCell, SceneTableNode, SceneTextLayout } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { paintTableNode } from './table-painting'

type Event = [string, ...unknown[]]

/** A context that records the calls paintPatternFill makes, plus the plain rect/fill a solid cell uses. */
class RecordingContext {
  readonly events: Event[] = []
  fillStyle = ''
  strokeStyle = ''
  globalAlpha = 1
  lineWidth = 1
  lineCap: CanvasLineCap = 'butt'
  font = ''
  textAlign: CanvasTextAlign = 'start'
  textBaseline: CanvasTextBaseline = 'alphabetic'
  shadowColor = ''
  shadowBlur = 0
  shadowOffsetX = 0
  shadowOffsetY = 0
  private lineDash: number[] = []

  save(): void { this.events.push(['save']) }
  restore(): void { this.events.push(['restore']) }
  beginPath(): void { this.events.push(['beginPath']) }
  closePath(): void { this.events.push(['closePath']) }
  clip(): void { this.events.push(['clip']) }
  rect(x: number, y: number, w: number, h: number): void { this.events.push(['rect', x, y, w, h]) }
  fillRect(x: number, y: number, w: number, h: number): void { this.events.push(['fillRect', this.fillStyle, x, y, w, h]) }
  fill(): void { this.events.push(['fill', this.fillStyle, this.globalAlpha]) }
  moveTo(x: number, y: number): void { this.events.push(['moveTo', x, y]) }
  lineTo(x: number, y: number): void { this.events.push(['lineTo', x, y]) }
  setLineDash(pattern: number[]): void { this.lineDash = [...pattern]; this.events.push(['setLineDash', ...pattern]) }
  stroke(): void { this.events.push(['stroke', this.strokeStyle, this.globalAlpha]) }
  fillText(text: string, x: number, y: number): void { this.events.push(['fillText', text, x, y]) }
  translate(): void {}
  rotate(): void {}
  scale(): void {}
}

function context(): RecordingContext & CanvasRenderingContext2D {
  return new RecordingContext() as unknown as RecordingContext & CanvasRenderingContext2D
}

function emptyTextLayout(): SceneTextLayout {
  return { bounds: { x: 10, y: 20, w: 30, h: 40 }, fontScale: 100000, overflow: false, contentBounds: { x: 10, y: 20, w: 30, h: 40 }, lines: [] }
}

function cell(overrides: Partial<SceneTableLayoutCell> = {}): SceneTableLayoutCell {
  return {
    row: 0,
    column: 0,
    rowSpan: 1,
    colSpan: 1,
    bounds: { x: 10, y: 20, w: 30, h: 40 },
    body: { paragraphs: [] },
    borders: {},
    textLayout: emptyTextLayout(),
    resolvedStyle: { borders: {} },
    ...overrides,
  }
}

function table(cells: SceneTableLayoutCell[]): SceneTableNode {
  return {
    id: 'table-1',
    kind: 'table',
    bounds: { x: 10, y: 20, w: 30, h: 40 },
    layout: { bounds: { x: 10, y: 20, w: 30, h: 40 }, columns: [30], rows: [40], borders: [], cells },
  }
}

const mapping = { scale: 1, offsetX: 0, offsetY: 0 }

describe('table cell pattern painting', () => {
  it('clips to the cell and fills both pattern colours, skipping the flat fill', () => {
    const ctx = context()
    paintTableNode(ctx, table([cell({
      resolvedFillColor: { rgb: 'FF0000', alpha: 100000 },
      resolvedFillPattern: { preset: 'pct25', foreground: { rgb: '203864', alpha: 100000 }, background: { rgb: 'FFFFFF', alpha: 100000 } },
    })]), mapping)

    const fillRects = ctx.events.filter(([type]) => type === 'fillRect')
    expect(ctx.events.some(([type]) => type === 'clip')).toBe(true)
    // The percentage preset paints its background then its foreground; the flat '#FF0000' never fills.
    expect(fillRects.map(([, style]) => style)).toEqual(['#FFFFFF', '#203864'])
    expect(ctx.events.some(([type, style]) => type === 'fill' && style === '#FF0000')).toBe(false)
  })

  it('paints the flat colour when the cell has no pattern', () => {
    const ctx = context()
    paintTableNode(ctx, table([cell({ resolvedFillColor: { rgb: 'FF0000', alpha: 100000 } })]), mapping)

    expect(ctx.events.some(([type]) => type === 'clip')).toBe(false)
    expect(ctx.events.some(([type, style]) => type === 'fill' && style === '#FF0000')).toBe(true)
  })
})

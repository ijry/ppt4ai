import type { SceneTableLayoutCell, SceneTableNode, SceneTextLayout } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { paintTableNode } from './table-painting'

type Event = [string, ...unknown[]]

class RecordingContext {
  readonly events: Event[] = []
  fillStyle: unknown = ''
  strokeStyle = ''
  globalAlpha = 1
  lineWidth = 1
  lineCap: CanvasLineCap = 'butt'
  font = ''
  textAlign: CanvasTextAlign = 'start'
  textBaseline: CanvasTextBaseline = 'alphabetic'

  save(): void {}
  restore(): void {}
  beginPath(): void { this.events.push(['beginPath']) }
  rect(x: number, y: number, w: number, h: number): void { this.events.push(['rect', x, y, w, h]) }
  fill(): void { this.events.push(['fill', this.fillStyle, this.globalAlpha]) }
  moveTo(): void {}
  lineTo(): void {}
  setLineDash(): void {}
  stroke(): void {}
  fillText(): void {}
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

function emptyTextLayout(): SceneTextLayout {
  return { bounds: { x: 0, y: 0, w: 100, h: 100 }, fontScale: 100000, overflow: false, contentBounds: { x: 0, y: 0, w: 100, h: 100 }, lines: [] }
}

function cell(overrides: Partial<SceneTableLayoutCell> = {}): SceneTableLayoutCell {
  return {
    row: 0,
    column: 0,
    rowSpan: 1,
    colSpan: 1,
    bounds: { x: 0, y: 0, w: 100, h: 100 },
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
    bounds: { x: 0, y: 0, w: 100, h: 100 },
    layout: { bounds: { x: 0, y: 0, w: 100, h: 100 }, columns: [100], rows: [100], borders: [], cells },
  }
}

const mapping = { scale: 1, offsetX: 0, offsetY: 0 }

describe('table cell gradient painting', () => {
  it('fills the cell with a gradient over the mapped box', () => {
    const ctx = context()
    paintTableNode(ctx, table([cell({
      resolvedFillColor: { rgb: '4472C4', alpha: 100000 },
      resolvedFillGradient: {
        stops: [{ pos: 0, color: { rgb: '4472C4', alpha: 100000 } }, { pos: 100000, color: { rgb: '203864', alpha: 100000 } }],
        angle: 5400000,
      },
    })]), mapping)

    // 90 degrees runs top to bottom of the 100x100 cell.
    const axis = ctx.events.find(([type]) => type === 'createLinearGradient')
    expect(axis?.[2] as number).toBeCloseTo(0)
    expect(axis?.[4] as number).toBeCloseTo(100)
    expect(ctx.events).toContainEqual(['addColorStop', 0, '#4472C4'])
    expect(ctx.events).toContainEqual(['addColorStop', 1, '#203864'])
    expect((ctx.fillStyle as { addColorStop?: unknown }).addColorStop).toBeDefined()
  })

  it('fills a flat colour when the cell resolves no gradient', () => {
    const ctx = context()
    paintTableNode(ctx, table([cell({ resolvedFillColor: { rgb: '4472C4', alpha: 100000 } })]), mapping)

    expect(ctx.events.some(([type]) => type === 'createLinearGradient')).toBe(false)
    expect(ctx.events.some(([type, style]) => type === 'fill' && style === '#4472C4')).toBe(true)
  })
})

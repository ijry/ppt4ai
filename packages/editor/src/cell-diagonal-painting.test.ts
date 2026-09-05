import type { ResolvedColor } from '@ppt4ai/model'
import type { SceneTableNode } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { paintTableNode } from './table-painting'

type Event = [string, ...unknown[]]

class RecordingContext {
  readonly events: Event[] = []
  fillStyle = ''
  strokeStyle = ''
  globalAlpha = 1
  lineWidth = 1
  lineCap = 'butt'
  font = ''
  textBaseline = 'alphabetic'

  save(): void {}
  restore(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  beginPath(): void { this.events.push(['beginPath']) }
  moveTo(x: number, y: number): void { this.events.push(['moveTo', x, y]) }
  lineTo(x: number, y: number): void { this.events.push(['lineTo', x, y]) }
  closePath(): void {}
  clip(): void {}
  rect(): void {}
  setLineDash(): void {}
  fillText(): void {}
  measureText(): { width: number } { return { width: 0 } }
  fill(): void { this.events.push(['fill', this.fillStyle]) }
  stroke(): void { this.events.push(['stroke', this.strokeStyle, this.lineWidth]) }
}

const red: ResolvedColor = { rgb: 'FF0000', alpha: 100000 }
const green: ResolvedColor = { rgb: '00FF00', alpha: 100000 }

function tableNode(borders: Record<string, unknown>, colors: Record<string, ResolvedColor>): SceneTableNode {
  return {
    id: 'table-1',
    kind: 'table',
    bounds: { x: 0, y: 0, w: 200, h: 100 },
    layout: {
      bounds: { x: 0, y: 0, w: 200, h: 100 },
      columns: [200],
      rows: [100],
      borders: [],
      cells: [{
        row: 0,
        column: 0,
        rowSpan: 1,
        colSpan: 1,
        bounds: { x: 0, y: 0, w: 200, h: 100 },
        body: { paragraphs: [{ runs: [] }] },
        borders: {},
        resolvedStyle: { borders: borders as never },
        resolvedBorderColors: colors as never,
        textLayout: {
          bounds: { x: 0, y: 0, w: 200, h: 100 },
          fontScale: 100000,
          overflow: false,
          contentBounds: { x: 0, y: 0, w: 200, h: 100 },
          lines: [],
        },
      }],
    },
  } as unknown as SceneTableNode
}

function paint(borders: Record<string, unknown>, colors: Record<string, ResolvedColor>): RecordingContext {
  const drawing = new RecordingContext()
  paintTableNode(drawing as unknown as CanvasRenderingContext2D, tableNode(borders, colors), { scale: 1, offsetX: 0, offsetY: 0 })
  return drawing
}

/** The two segments the painter should draw, as `moveTo`/`lineTo` pairs. */
function segments(drawing: RecordingContext): Array<[number, number, number, number]> {
  const output: Array<[number, number, number, number]> = []
  for (const [index, event] of drawing.events.entries()) {
    if (event[0] !== 'moveTo') continue
    const next = drawing.events[index + 1]
    if (next?.[0] !== 'lineTo') continue
    output.push([event[1] as number, event[2] as number, next[1] as number, next[2] as number])
  }
  return output
}

describe('cell diagonal painting', () => {
  it('draws each diagonal corner to corner of the cell rect', () => {
    const drawing = paint(
      { tlToBr: { color: { type: 'srgb', v: 'FF0000' }, width: 2, style: 'solid' }, blToTr: { color: { type: 'srgb', v: '00FF00' }, width: 2, style: 'solid' } },
      { tlToBr: red, blToTr: green },
    )

    expect(segments(drawing)).toEqual([[0, 0, 200, 100], [0, 100, 200, 0]])
  })

  /** The diagonals come last, so a cell with all six borders paints them on top of the four sides. */
  it('paints the diagonals after the four sides', () => {
    const border = { color: { type: 'srgb', v: 'FF0000' }, width: 2, style: 'solid' }
    const drawing = paint(
      { left: border, right: border, top: border, bottom: border, tlToBr: border, blToTr: border },
      { left: red, right: red, top: red, bottom: red, tlToBr: red, blToTr: red },
    )
    const drawn = segments(drawing)

    expect(drawn).toHaveLength(6)
    expect(drawn[4]).toEqual([0, 0, 200, 100])
    expect(drawn[5]).toEqual([0, 100, 200, 0])
  })

  it('skips a diagonal whose style is none or whose colour did not resolve', () => {
    const none = paint({ tlToBr: { color: { type: 'srgb', v: 'FF0000' }, style: 'none' } }, { tlToBr: red })
    const unresolved = paint({ tlToBr: { color: { type: 'srgb', v: 'FF0000' }, style: 'solid' } }, {})

    expect(segments(none)).toEqual([])
    expect(segments(unresolved)).toEqual([])
  })
})

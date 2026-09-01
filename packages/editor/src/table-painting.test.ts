import type { TableBorder } from '@ppt4ai/model'
import type { SceneTableLayoutCell, SceneTableNode, SceneTextLayout } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { paintTableNode } from './table-painting'

type Event = [string, ...unknown[]]

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
  private lineDash: number[] = []

  save(): void { this.events.push(['save']) }
  restore(): void { this.events.push(['restore']) }
  beginPath(): void { this.events.push(['beginPath']) }
  rect(x: number, y: number, width: number, height: number): void {
    this.events.push(['rect', x, y, width, height])
  }
  fill(): void { this.events.push(['fill', this.fillStyle, this.globalAlpha]) }
  moveTo(x: number, y: number): void { this.events.push(['moveTo', x, y]) }
  lineTo(x: number, y: number): void { this.events.push(['lineTo', x, y]) }
  setLineDash(pattern: number[]): void {
    this.lineDash = [...pattern]
    this.events.push(['setLineDash', ...pattern])
  }
  stroke(): void {
    this.events.push(['stroke', this.strokeStyle, this.globalAlpha, this.lineWidth, this.lineCap, [...this.lineDash]])
  }
  fillText(text: string, x: number, y: number): void {
    this.events.push(['fillText', text, x, y, this.fillStyle, this.globalAlpha])
  }
  translate(x: number, y: number): void { this.events.push(['translate', x, y]) }
  rotate(angle: number): void { this.events.push(['rotate', angle]) }
}

function context(): RecordingContext & CanvasRenderingContext2D {
  return new RecordingContext() as unknown as RecordingContext & CanvasRenderingContext2D
}

function textLayout(text = 'A', x = 12, y = 22): SceneTextLayout {
  return {
    bounds: { x, y, w: 20, h: 10 },
    fontScale: 100000,
    overflow: false,
    contentBounds: { x, y, w: 20, h: 10 },
    lines: text.length === 0 ? [] : [{
      paragraphIndex: 0,
      x,
      y,
      width: 20,
      height: 10,
      runs: [{ text, x, width: 20, marks: { fontSize: 1 } }],
    }],
  }
}

function border(style?: TableBorder['style'], width?: number): TableBorder {
  return {
    color: { type: 'srgb', v: '000000' },
    ...(style ? { style } : {}),
    ...(width === undefined ? {} : { width }),
  }
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
    textLayout: textLayout(),
    resolvedStyle: { borders: {} },
    ...overrides,
  }
}

function table(cells: SceneTableLayoutCell[] = [cell()]): SceneTableNode {
  return {
    id: 'table-1',
    kind: 'table',
    bounds: { x: 10, y: 20, w: 60, h: 40 },
    layout: {
      bounds: { x: 10, y: 20, w: 60, h: 40 },
      columns: [30, 30],
      rows: [40],
      borders: [],
      cells,
    },
  }
}

describe('table painting', () => {
  it('paints all fills, ordered borders, then absolute precomputed text', () => {
    const drawingContext = context()
    const first = cell({
      colSpan: 2,
      bounds: { x: 10, y: 20, w: 30, h: 40 },
      resolvedFillColor: { rgb: '336699', alpha: 50000 },
      resolvedStyle: {
        borders: {
          left: border('solid', 1),
          right: border('dash', 2),
          top: border('dot', 3),
          bottom: border('none', 4),
        },
      },
      resolvedBorderColors: {
        left: { rgb: '110000', alpha: 100000 },
        right: { rgb: '220000', alpha: 75000 },
        top: { rgb: '330000', alpha: 50000 },
        bottom: { rgb: '440000', alpha: 25000 },
      },
      textLayout: textLayout('A', 12, 22),
    })
    const second = cell({
      column: 1,
      bounds: { x: 40, y: 20, w: 30, h: 40 },
      resolvedFillColor: { rgb: 'ABCDEF', alpha: 100000 },
      resolvedStyle: { borders: { left: border('solid', 1) } },
      resolvedBorderColors: { left: { rgb: '00AA00', alpha: 100000 } },
      textLayout: textLayout('B', 42, 22),
    })

    paintTableNode(drawingContext, table([first, second]), { scale: 2, offsetX: 5, offsetY: 7 })

    expect(drawingContext.events).toContainEqual(['rect', 25, 47, 60, 80])
    expect(drawingContext.events.filter(([type]) => type === 'fill')).toEqual([
      ['fill', '#336699', 0.5],
      ['fill', '#ABCDEF', 1],
    ])
    expect(drawingContext.events.filter(([type]) => type === 'fill' || type === 'stroke' || type === 'fillText').map(([type, value]) => type === 'fillText' ? value : type)).toEqual([
      'fill',
      'fill',
      'stroke',
      'stroke',
      'stroke',
      'stroke',
      'A',
      'B',
    ])
    expect(drawingContext.events.filter(([type]) => type === 'moveTo')).toEqual([
      ['moveTo', 25, 47],
      ['moveTo', 85, 47],
      ['moveTo', 25, 47],
      ['moveTo', 85, 47],
    ])
    expect(drawingContext.events.filter(([type]) => type === 'lineTo')).toEqual([
      ['lineTo', 25, 127],
      ['lineTo', 85, 127],
      ['lineTo', 85, 47],
      ['lineTo', 85, 127],
    ])
    expect(drawingContext.events.filter(([type]) => type === 'fillText')).toEqual([
      ['fillText', 'A', 29, 51, '#000000', 1],
      ['fillText', 'B', 89, 51, '#000000', 1],
    ])
    expect(drawingContext.events[0]).toEqual(['save'])
    expect(drawingContext.events.at(-1)).toEqual(['restore'])
  })

  it('applies border defaults, dash patterns, minimum widths, and omissions', () => {
    const drawingContext = context()
    const styled = cell({
      textLayout: textLayout(''),
      resolvedStyle: {
        borders: {
          left: border(),
          right: border('dash', 200000),
          top: border('dot', 0),
          bottom: border('none', 200000),
        },
      },
      resolvedBorderColors: {
        left: { rgb: '111111', alpha: 100000 },
        right: { rgb: '222222', alpha: 50000 },
        top: { rgb: '333333', alpha: 25000 },
        bottom: { rgb: '444444', alpha: 100000 },
      },
    })
    const missingColors = cell({
      column: 1,
      bounds: { x: 40, y: 20, w: 30, h: 40 },
      textLayout: textLayout(''),
      resolvedStyle: { borders: { left: border('solid', 200000) } },
    })

    paintTableNode(drawingContext, table([styled, missingColors]), { scale: 0.00001, offsetX: 0, offsetY: 0 })

    expect(drawingContext.events.filter(([type]) => type === 'setLineDash')).toEqual([
      ['setLineDash'],
      ['setLineDash', 8, 6],
      ['setLineDash', 1, 2],
    ])
    expect(drawingContext.events.filter(([type]) => type === 'stroke')).toEqual([
      ['stroke', '#111111', 1, 1, 'butt', []],
      ['stroke', '#222222', 0.5, 2, 'butt', [8, 6]],
      ['stroke', '#333333', 0.25, 1, 'butt', [1, 2]],
    ])
    expect(drawingContext.events.filter(([type]) => type === 'fill')).toHaveLength(0)
    expect(drawingContext.events.filter(([type]) => type === 'fillText')).toHaveLength(0)
  })

  it('uses supplied merged-cell bounds and paints duplicate shared edges deterministically', () => {
    const drawingContext = context()
    const merged = cell({
      colSpan: 2,
      bounds: { x: 10, y: 20, w: 60, h: 40 },
      textLayout: textLayout(''),
      resolvedStyle: { borders: { right: border('solid', 1) } },
      resolvedBorderColors: { right: { rgb: 'FF0000', alpha: 100000 } },
    })
    const adjacent = cell({
      column: 1,
      bounds: { x: 70, y: 20, w: 30, h: 40 },
      textLayout: textLayout(''),
      resolvedStyle: { borders: { left: border('solid', 1) } },
      resolvedBorderColors: { left: { rgb: '00FF00', alpha: 100000 } },
    })

    paintTableNode(drawingContext, table([merged, adjacent]), { scale: 1, offsetX: 0, offsetY: 0 })

    expect(drawingContext.events.filter(([type]) => type === 'moveTo')).toEqual([
      ['moveTo', 70, 20],
      ['moveTo', 70, 20],
    ])
    expect(drawingContext.events.filter(([type]) => type === 'stroke').map((event) => event[1])).toEqual(['#FF0000', '#00FF00'])
  })

  it('accepts empty tables and cells with empty text', () => {
    const emptyTableContext = context()
    paintTableNode(emptyTableContext, table([]), { scale: 1, offsetX: 0, offsetY: 0 })
    expect(emptyTableContext.events).toEqual([['save'], ['restore']])

    const emptyTextContext = context()
    paintTableNode(emptyTextContext, table([cell({ textLayout: textLayout('') })]), { scale: 1, offsetX: 0, offsetY: 0 })
    expect(emptyTextContext.events.filter(([type]) => type === 'fillText')).toHaveLength(0)
    expect(emptyTextContext.events.at(-1)).toEqual(['restore'])
  })

  it('rotates the whole table about its mapped centre', () => {
    const drawingContext = context()
    const rotated: SceneTableNode = { ...table(), transform: { rotation: 5400000 } }

    paintTableNode(drawingContext, rotated, { scale: 2, offsetX: 100, offsetY: 200 })

    const centreX = 100 + (10 + 60 / 2) * 2
    const centreY = 200 + (20 + 40 / 2) * 2
    expect(drawingContext.events.slice(0, 5)).toEqual([
      ['save'],
      ['save'],
      ['translate', centreX, centreY],
      ['rotate', Math.PI / 2],
      ['translate', -centreX, -centreY],
    ])
    expect(drawingContext.events.at(-1)).toEqual(['restore'])
  })

  it('leaves an unrotated table free of transform calls', () => {
    const drawingContext = context()

    paintTableNode(drawingContext, table(), { scale: 1, offsetX: 0, offsetY: 0 })

    expect(drawingContext.events.filter(([type]) => type === 'rotate' || type === 'translate')).toEqual([])
  })

  it.each<Array<string | ((drawingContext: CanvasRenderingContext2D) => void)>>([
    ['non-positive mapping', (drawingContext) => paintTableNode(drawingContext, table(), { scale: 0, offsetX: 0, offsetY: 0 })],
    ['non-finite mapping offset', (drawingContext) => paintTableNode(drawingContext, table(), { scale: 1, offsetX: Number.NaN, offsetY: 0 })],
    ['negative cell dimension', (drawingContext) => paintTableNode(drawingContext, table([cell({ bounds: { x: 0, y: 0, w: -1, h: 1 } })]), { scale: 1, offsetX: 0, offsetY: 0 })],
    ['invalid fill RGB', (drawingContext) => paintTableNode(drawingContext, table([cell({ resolvedFillColor: { rgb: 'bad', alpha: 100000 } })]), { scale: 1, offsetX: 0, offsetY: 0 })],
    ['invalid fill alpha', (drawingContext) => paintTableNode(drawingContext, table([cell({ resolvedFillColor: { rgb: '336699', alpha: 100001 } })]), { scale: 1, offsetX: 0, offsetY: 0 })],
    ['invalid border RGB', (drawingContext) => paintTableNode(drawingContext, table([cell({ resolvedStyle: { borders: { left: border() } }, resolvedBorderColors: { left: { rgb: 'bad', alpha: 100000 } } })]), { scale: 1, offsetX: 0, offsetY: 0 })],
    ['invalid border alpha', (drawingContext) => paintTableNode(drawingContext, table([cell({ resolvedStyle: { borders: { left: border() } }, resolvedBorderColors: { left: { rgb: '336699', alpha: -1 } } })]), { scale: 1, offsetX: 0, offsetY: 0 })],
    ['unsupported border style', (drawingContext) => paintTableNode(drawingContext, table([cell({ resolvedStyle: { borders: { left: { ...border(), style: 'double' as 'solid' } } }, resolvedBorderColors: { left: { rgb: '336699', alpha: 100000 } } })]), { scale: 1, offsetX: 0, offsetY: 0 })],
    ['non-finite border width', (drawingContext) => paintTableNode(drawingContext, table([cell({ resolvedStyle: { borders: { left: border('solid', Number.NaN) } }, resolvedBorderColors: { left: { rgb: '336699', alpha: 100000 } } })]), { scale: 1, offsetX: 0, offsetY: 0 })],
    ['negative border width', (drawingContext) => paintTableNode(drawingContext, table([cell({ resolvedStyle: { borders: { left: border('solid', -1) } }, resolvedBorderColors: { left: { rgb: '336699', alpha: 100000 } } })]), { scale: 1, offsetX: 0, offsetY: 0 })],
  ])('rejects %s and restores context', (_label, draw) => {
    const drawingContext = context()
    expect(() => (draw as (value: CanvasRenderingContext2D) => void)(drawingContext)).toThrow()
    expect(drawingContext.events.at(-1)).toEqual(['restore'])
  })

  it.each([
    ['fill', (drawingContext: CanvasRenderingContext2D) => { drawingContext.fill = () => { throw new Error('fill failed') } }, cell({ resolvedFillColor: { rgb: '336699', alpha: 100000 }, textLayout: textLayout('') })],
    ['stroke', (drawingContext: CanvasRenderingContext2D) => { drawingContext.stroke = () => { throw new Error('stroke failed') } }, cell({ resolvedStyle: { borders: { left: border() } }, resolvedBorderColors: { left: { rgb: '336699', alpha: 100000 } }, textLayout: textLayout('') })],
    ['text', (drawingContext: CanvasRenderingContext2D) => { drawingContext.fillText = () => { throw new Error('text failed') } }, cell()],
  ])('restores table state when Canvas %s painting fails', (_label, breakCanvas, sourceCell) => {
    const drawingContext = context()
    breakCanvas(drawingContext)
    expect(() => paintTableNode(drawingContext, table([sourceCell]), { scale: 1, offsetX: 0, offsetY: 0 })).toThrow()
    expect(drawingContext.events.at(-1)).toEqual(['restore'])
  })
})

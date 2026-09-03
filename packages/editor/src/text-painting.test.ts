import type { SceneTextNode } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { paintTextLayout, paintTextNode } from './text-painting'

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

  save(): void { this.events.push(['save']) }
  restore(): void { this.events.push(['restore']) }
  fillText(text: string, x: number, y: number): void {
    this.events.push(['fillText', text, x, y, {
      font: this.font,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      fillStyle: this.fillStyle,
      globalAlpha: this.globalAlpha,
    }])
  }
  beginPath(): void { this.events.push(['beginPath']) }
  moveTo(x: number, y: number): void { this.events.push(['moveTo', x, y]) }
  lineTo(x: number, y: number): void { this.events.push(['lineTo', x, y]) }
  stroke(): void { this.events.push(['stroke', {
    strokeStyle: this.strokeStyle,
    globalAlpha: this.globalAlpha,
    lineWidth: this.lineWidth,
  }]) }
  translate(x: number, y: number): void { this.events.push(['translate', x, y]) }
  rotate(angle: number): void { this.events.push(['rotate', angle]) }
  scale(x: number, y: number): void { this.events.push(['scale', x, y]) }
}

function context(): RecordingContext & CanvasRenderingContext2D {
  return new RecordingContext() as unknown as RecordingContext & CanvasRenderingContext2D
}

function node(overrides: Partial<SceneTextNode> = {}): SceneTextNode {
  return {
    id: 'text-1',
    kind: 'text',
    bounds: { x: 0, y: 0, w: 1000, h: 500 },
    text: 'Title',
    layout: {
      bounds: { x: 0, y: 0, w: 1000, h: 500 },
      fontScale: 50000,
      overflow: false,
      contentBounds: { x: 50, y: 200, w: 350, h: 100 },
      lines: [{
        paragraphIndex: 0,
        x: 100,
        y: 200,
        width: 300,
        height: 100,
        marker: { text: '1.', x: 50, width: 40, marks: { fontSize: 10 } },
        runs: [{
          text: 'Title',
          x: 100,
          width: 300,
          marks: {
            fontFamily: 'Aptos Display',
            fontSize: 20,
            bold: true,
            italic: true,
            underline: 'single',
          },
          resolvedColor: { rgb: '336699', alpha: 50000 },
        }],
      }],
    },
    ...overrides,
  }
}

function withoutMarker(line: SceneTextNode['layout']['lines'][number]): SceneTextNode['layout']['lines'][number] {
  const { marker: _marker, ...lineWithoutMarker } = line
  return lineWithoutMarker
}

describe('text rotation', () => {
  const mapping = { scale: 0.001, offsetX: 5, offsetY: 7 }

  it('rotates about the mapped bounds centre when the node carries a rotation', () => {
    const drawingContext = context()

    paintTextNode(drawingContext, node({ transform: { rotation: 5400000 } }), mapping)

    const transformEvents = drawingContext.events.filter(([type]) => type === 'translate' || type === 'rotate')
    expect(transformEvents).toEqual([
      ['translate', 5.5, 7.25],
      ['rotate', Math.PI / 2],
      ['translate', -5.5, -7.25],
    ])
    expect(drawingContext.events.at(-1)).toEqual(['restore'])
  })

  it('does not emit rotation transforms when the node has no rotation', () => {
    const drawingContext = context()

    paintTextNode(drawingContext, node(), mapping)

    expect(drawingContext.events.filter(([type]) => type === 'rotate')).toEqual([])
  })

  it('does not mirror text, because PowerPoint flips a shape but leaves its text readable', () => {
    const drawingContext = context()

    paintTextNode(drawingContext, node({ transform: { flipH: true, flipV: true } }), mapping)

    expect(drawingContext.events.filter(([type]) => type === 'scale')).toEqual([])
    expect(drawingContext.events.some(([type]) => type === 'fillText')).toBe(true)
  })

  it('still rotates a flipped text node', () => {
    const drawingContext = context()

    paintTextNode(drawingContext, node({ transform: { rotation: 5400000, flipH: true } }), mapping)

    expect(drawingContext.events.filter(([type]) => type === 'rotate')).toEqual([['rotate', Math.PI / 2]])
    expect(drawingContext.events.filter(([type]) => type === 'scale')).toEqual([])
  })
})

describe('text painting', () => {
  it('paints a precomputed layout without a scene text node', () => {
    const drawingContext = context()

    paintTextLayout(drawingContext, node().layout, { scale: 0.001, offsetX: 5, offsetY: 7 })

    expect(drawingContext.events.filter(([type]) => type === 'fillText')).toEqual([
      ['fillText', '1.', 5.05, 7.2, expect.any(Object)],
      ['fillText', 'Title', 5.1, 7.2, expect.any(Object)],
    ])
    expect(drawingContext.events[0]).toEqual(['save'])
    expect(drawingContext.events.at(-1)).toEqual(['restore'])
  })

  it('paints markers before styled runs at precomputed positions', () => {
    const drawingContext = context()

    paintTextNode(drawingContext, node(), { scale: 0.001, offsetX: 5, offsetY: 7 })

    const fillTextEvents = drawingContext.events.filter(([type]) => type === 'fillText')
    expect(fillTextEvents.map((event) => event.slice(0, 4))).toEqual([
      ['fillText', '1.', 5.05, 7.2],
      ['fillText', 'Title', 5.1, 7.2],
    ])
    expect(fillTextEvents[1]?.[4]).toMatchObject({
      font: 'italic bold 127px "Aptos Display"',
      fillStyle: '#336699',
      globalAlpha: 0.5,
      textAlign: 'left',
      textBaseline: 'top',
    })
    expect(drawingContext.events).toContainEqual(['moveTo', 5.1, 7.29])
    expect(drawingContext.events).toContainEqual(['lineTo', 5.4, 7.29])
    const underlineState = drawingContext.events.find(([type]) => type === 'stroke')?.[1] as {
      strokeStyle: string
      globalAlpha: number
      lineWidth: number
    }
    expect(underlineState).toMatchObject({
      strokeStyle: '#336699',
      globalAlpha: 0.5,
    })
    expect(underlineState.lineWidth).toBeCloseTo(6.35)
    expect(drawingContext.events[0]).toEqual(['save'])
    expect(drawingContext.events.at(-1)).toEqual(['restore'])
  })

  it('uses default font and opaque black when marks and color are absent', () => {
    const drawingContext = context()
    const defaultNode = node({
      layout: {
        ...node().layout,
        lines: [{
          ...withoutMarker(node().layout.lines[0]!),
          runs: [{ text: 'Body', x: 100, width: 100 }],
        }],
      },
    })

    paintTextNode(drawingContext, defaultNode, { scale: 0.001, offsetX: 0, offsetY: 0 })

    expect(drawingContext.events.find(([type]) => type === 'fillText')?.[4]).toMatchObject({
      font: '114.3px "Arial"',
      fillStyle: '#000000',
      globalAlpha: 1,
    })
  })

  it('paints a theme font reference with the family the scene resolved', () => {
    const drawingContext = context()
    const themedNode = node({
      layout: {
        ...node().layout,
        lines: [{
          ...node().layout.lines[0]!,
          marker: { text: '1.', x: 50, width: 40, marks: { fontSize: 10, fontFamily: '+mn-lt' }, resolvedFontFamily: 'Calibri' },
          runs: [{ text: 'Heading', x: 100, width: 100, marks: { fontSize: 20, fontFamily: '+mj-lt' }, resolvedFontFamily: 'Cambria' }],
        }],
      },
    })

    paintTextNode(drawingContext, themedNode, { scale: 0.001, offsetX: 0, offsetY: 0 })

    const fonts = drawingContext.events.filter(([type]) => type === 'fillText').map((event) => (event[4] as { font: string }).font)
    expect(fonts).toEqual(['63.5px "Calibri"', '127px "Cambria"'])
  })

  it('ignores a reference the scene could not resolve rather than asking for a "+" family', () => {
    const drawingContext = context()
    const unresolvedNode = node({
      layout: {
        ...node().layout,
        lines: [{
          ...withoutMarker(node().layout.lines[0]!),
          runs: [{ text: 'Body', x: 100, width: 100, marks: { fontSize: 20, fontFamily: '+mj-cs' } }],
        }],
      },
    })

    paintTextNode(drawingContext, unresolvedNode, { scale: 0.001, offsetX: 0, offsetY: 0 })

    expect(drawingContext.events.find(([type]) => type === 'fillText')?.[4]).toMatchObject({ font: '127px "Arial"' })
  })

  it('paints a mixed-script line with one font per script span', () => {
    const drawingContext = context()
    const mixedNode = node({
      layout: {
        ...node().layout,
        lines: [{
          ...withoutMarker(node().layout.lines[0]!),
          runs: [
            { text: 'Hi ', x: 100, width: 60, marks: { fontSize: 20, fontFamily: 'Calibri', fontFamilyEa: '宋体' } },
            { text: '你好', x: 160, width: 80, marks: { fontSize: 20, fontFamily: 'Calibri', fontFamilyEa: '宋体' }, resolvedFontFamily: '宋体' },
          ],
        }],
      },
    })

    paintTextNode(drawingContext, mixedNode, { scale: 0.001, offsetX: 0, offsetY: 0 })

    const fonts = drawingContext.events.filter(([type]) => type === 'fillText').map((event) => (event[4] as { font: string }).font)
    expect(fonts).toEqual(['127px "Calibri"', '127px "宋体"'])
  })

  it('restores context when fillText fails', () => {
    const drawingContext = context()
    drawingContext.fillText = () => { throw new Error('text failed') }

    expect(() => paintTextNode(drawingContext, node(), { scale: 0.001, offsetX: 0, offsetY: 0 })).toThrow('text failed')
    expect(drawingContext.events.at(-1)).toEqual(['restore'])
  })

  it('paints upright and rotated vertical items with their precomputed geometry', () => {
    const drawingContext = context()
    const verticalNode = node({
      text: '*中A',
      layout: {
        bounds: { x: 0, y: 0, w: 500, h: 1000 },
        fontScale: 100000,
        overflow: false,
        vertical: 'vertical',
        contentBounds: { x: 200, y: 100, w: 100, h: 500 },
        lines: [{
          paragraphIndex: 0,
          x: 200,
          y: 100,
          width: 100,
          height: 500,
          marker: { text: '*', x: 200, y: 100, width: 100, height: 80, orientation: 'rotated' },
          runs: [
            { text: '中', x: 200, y: 180, width: 100, height: 100, orientation: 'upright' },
            { text: 'A', x: 200, y: 280, width: 100, height: 80, orientation: 'rotated' },
          ],
        }],
      },
    })

    paintTextNode(drawingContext, verticalNode, { scale: 0.01, offsetX: 1, offsetY: 2 })

    const verticalFillEvents = drawingContext.events
      .filter(([type]) => type === 'fillText')
      .map((event) => event.slice(0, 4))
    expect(verticalFillEvents).toEqual([
      ['fillText', '*', 0, 0],
      ['fillText', '中', 3, 3.8],
      ['fillText', 'A', 0, 0],
    ])
    expect(drawingContext.events).toContainEqual(['translate', 4, 3])
    const latinTranslation = drawingContext.events.filter(([type]) => type === 'translate')[1]!
    expect(latinTranslation[1]).toBe(4)
    expect(latinTranslation[2]).toBeCloseTo(4.8)
    expect(drawingContext.events.filter(([type]) => type === 'rotate')).toEqual([
      ['rotate', Math.PI / 2],
      ['rotate', Math.PI / 2],
    ])
    expect(drawingContext.events.filter(([type]) => type === 'save')).toHaveLength(3)
    expect(drawingContext.events.filter(([type]) => type === 'restore')).toHaveLength(3)
  })

  it('counts empty text nodes and runs as drawn without fillText', () => {
    const emptyNodeContext = context()
    paintTextNode(emptyNodeContext, node({
      text: '',
      layout: { ...node().layout, lines: [] },
    }), { scale: 1, offsetX: 0, offsetY: 0 })

    expect(emptyNodeContext.events).toEqual([['save'], ['restore']])

    const emptyRunContext = context()
    const emptyNode = node({
      text: '',
      layout: { ...node().layout, lines: [{ ...withoutMarker(node().layout.lines[0]!), runs: [{ text: '', x: 0, width: 0 }] }] },
    })

    paintTextNode(emptyRunContext, emptyNode, { scale: 1, offsetX: 0, offsetY: 0 })

    expect(emptyRunContext.events.filter(([type]) => type === 'fillText')).toHaveLength(0)
    expect(emptyRunContext.events).toEqual([['save'], ['restore']])
  })

  it.each<Array<string | ((drawingContext: CanvasRenderingContext2D) => void)>>([
    ['non-finite mapping', (drawingContext) => paintTextNode(drawingContext, node(), { scale: Number.NaN, offsetX: 0, offsetY: 0 })],
    ['non-finite font scale', (drawingContext) => paintTextNode(drawingContext, node({ layout: { ...node().layout, fontScale: Number.NaN } }), { scale: 1, offsetX: 0, offsetY: 0 })],
    ['negative line dimension', (drawingContext) => paintTextNode(drawingContext, node({ layout: { ...node().layout, lines: [{ ...node().layout.lines[0]!, width: -1 }] } }), { scale: 1, offsetX: 0, offsetY: 0 })],
    ['non-finite run position', (drawingContext) => paintTextNode(drawingContext, node({ layout: { ...node().layout, lines: [{ ...node().layout.lines[0]!, runs: [{ text: 'bad', x: Number.POSITIVE_INFINITY, width: 1 }] }] } }), { scale: 1, offsetX: 0, offsetY: 0 })],
    ['zero font size', (drawingContext) => paintTextNode(drawingContext, node({ layout: { ...node().layout, lines: [{ ...withoutMarker(node().layout.lines[0]!), runs: [{ text: 'bad', x: 0, width: 1, marks: { fontSize: 0 } }] }] } }), { scale: 1, offsetX: 0, offsetY: 0 })],
    ['invalid RGB', (drawingContext) => paintTextNode(drawingContext, node({ layout: { ...node().layout, lines: [{ ...node().layout.lines[0]!, runs: [{ ...node().layout.lines[0]!.runs[0]!, resolvedColor: { rgb: 'bad', alpha: 100000 } }] }] } }), { scale: 1, offsetX: 0, offsetY: 0 })],
    ['invalid alpha', (drawingContext) => paintTextNode(drawingContext, node({ layout: { ...node().layout, lines: [{ ...node().layout.lines[0]!, runs: [{ ...node().layout.lines[0]!.runs[0]!, resolvedColor: { rgb: '336699', alpha: 100001 } }] }] } }), { scale: 1, offsetX: 0, offsetY: 0 })],
    ['invalid orientation', (drawingContext) => paintTextNode(drawingContext, node({ layout: { ...node().layout, vertical: 'vertical', lines: [{ ...node().layout.lines[0]!, runs: [{ text: 'bad', x: 0, y: 0, width: 1, height: 1, orientation: 'diagonal' as 'upright' }] }] } }), { scale: 1, offsetX: 0, offsetY: 0 })],
  ])('rejects %s and restores context', (_label, draw) => {
    const drawingContext = context()
    expect(() => (draw as (context: CanvasRenderingContext2D) => void)(drawingContext)).toThrow()
    expect(drawingContext.events.at(-1)).toEqual(['restore'])
  })

  it('restores nested and outer state when rotated text drawing fails', () => {
    const drawingContext = context()
    drawingContext.fillText = () => { throw new Error('vertical text failed') }
    const verticalNode = node({
      layout: {
        ...node().layout,
        vertical: 'vertical',
        lines: [{
          ...withoutMarker(node().layout.lines[0]!),
          runs: [{ text: 'A', x: 100, y: 200, width: 50, height: 80, orientation: 'rotated' }],
        }],
      },
    })

    expect(() => paintTextNode(drawingContext, verticalNode, { scale: 1, offsetX: 0, offsetY: 0 })).toThrow('vertical text failed')
    expect(drawingContext.events).toEqual([
      ['save'],
      ['save'],
      ['translate', 150, 200],
      ['rotate', Math.PI / 2],
      ['restore'],
      ['restore'],
    ])
  })
})

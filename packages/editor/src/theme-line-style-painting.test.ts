import type { Element, Ppt4aiDocument, Theme } from '@ppt4ai/model'
import { documentToSceneGraph } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { paintShapeNode } from './shape-painting'

type Event = [string, ...unknown[]]

class RecordingContext {
  readonly events: Event[] = []
  fillStyle = ''
  strokeStyle = ''
  globalAlpha = 1
  lineWidth = 1

  save(): void { this.events.push(['save']) }
  restore(): void { this.events.push(['restore']) }
  translate(x: number, y: number): void { this.events.push(['translate', x, y]) }
  rotate(angle: number): void { this.events.push(['rotate', angle]) }
  scale(x: number, y: number): void { this.events.push(['scale', x, y]) }
  beginPath(): void { this.events.push(['beginPath']) }
  moveTo(x: number, y: number): void { this.events.push(['moveTo', x, y]) }
  lineTo(x: number, y: number): void { this.events.push(['lineTo', x, y]) }
  ellipse(...args: number[]): void { this.events.push(['ellipse', ...args]) }
  closePath(): void { this.events.push(['closePath']) }
  setLineDash(pattern: number[]): void { this.events.push(['setLineDash', ...pattern]) }
  fill(): void { this.events.push(['fill']) }
  stroke(): void { this.events.push(['stroke', this.strokeStyle, this.lineWidth]) }
}

const theme: Theme = {
  id: 'theme-1',
  colors: { accent1: { type: 'srgb', v: '4472C4' } },
  formatScheme: {
    lineStyles: [
      { color: { type: 'scheme', v: 'phClr' }, width: 6350 },
      { color: { type: 'scheme', v: 'phClr' }, width: 12700, style: 'dash' },
    ],
  },
}

/** The stock Office shape: nothing in spPr, the outline comes entirely from the style matrix. */
const styledShape: Element = {
  id: 'el_shape',
  kind: 'shape',
  preset: 'rect',
  bounds: { x: 0, y: 0, w: 2000000, h: 1000000 },
  styleRef: { line: { idx: 2, color: { type: 'scheme', v: 'accent1' } } },
}

function document(element: Element): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_line_style',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [element.id], layoutId: 'lyt_1' } },
    slideOrder: ['sld_1'],
    elements: { [element.id]: element },
    layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } },
    masters: { mst_1: { id: 'mst_1', themeId: 'theme-1' } },
    themes: { 'theme-1': theme },
  }
}

function paint(element: Element): RecordingContext {
  const context = new RecordingContext()
  const node = documentToSceneGraph(document(element)).nodes[0]
  if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
  paintShapeNode(context as unknown as CanvasRenderingContext2D, node, { scale: 0.001, offsetX: 0, offsetY: 0 })
  return context
}

function strokeOf(context: RecordingContext): { style: unknown; width: number } {
  const event = context.events.find(([type]) => type === 'stroke')
  if (!event) throw new Error('nothing was stroked')
  return { style: event[1], width: event[2] as number }
}

function dashOf(context: RecordingContext): number[] {
  const event = context.events.find(([type]) => type === 'setLineDash')
  if (!event) throw new Error('no dash pattern was set')
  return event.slice(1) as number[]
}

describe('theme line styles reach the canvas', () => {
  /** Before this the theme said 1pt dashed and the canvas drew a 1px solid hairline. */
  it('paints the entry width and dash for a shape styled only by lnRef', () => {
    const stroke = strokeOf(paint(styledShape))
    const dash = dashOf(paint(styledShape))

    expect(stroke.style).toBe('#4472C4')
    expect(stroke.width).toBeCloseTo(12.7)
    expect(dash).toHaveLength(2)
    expect(dash[0]).toBeCloseTo(50.8)
    expect(dash[1]).toBeCloseTo(38.1)
  })

  it('lets the element own width win while still taking the entry dash', () => {
    const context = paint({ ...styledShape, strokeWidth: 76200 })

    expect(strokeOf(context).width).toBeCloseTo(76.2)
    expect(dashOf(context)[0]).toBeCloseTo(304.8)
  })

  it('paints a solid line at the entry width when the entry declares no dash', () => {
    const context = paint({ ...styledShape, styleRef: { line: { idx: 1, color: { type: 'scheme', v: 'accent1' } } } })

    expect(strokeOf(context).width).toBeCloseTo(6.35)
    expect(dashOf(context)).toEqual([])
  })
})

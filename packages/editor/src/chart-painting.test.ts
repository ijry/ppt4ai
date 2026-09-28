import type { SceneChartNode } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { paintChartNode } from './chart-painting'

function context(): CanvasRenderingContext2D & { calls: { rects: unknown[][]; strokeRects: unknown[][]; texts: unknown[][] } } {
  const calls = { rects: [] as unknown[][], strokeRects: [] as unknown[][], texts: [] as unknown[][] }
  return {
    calls,
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, setLineDash() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    fillRect: (...args: unknown[]) => { calls.rects.push(args) },
    strokeRect: (...args: unknown[]) => { calls.strokeRects.push(args) },
    fillText: (...args: unknown[]) => { calls.texts.push(args) },
  } as unknown as CanvasRenderingContext2D & { calls: { rects: unknown[][]; strokeRects: unknown[][]; texts: unknown[][] } }
}

describe('chart placeholder painting', () => {
  it('draws a filled panel, a border, and a label in the mapped bounds', () => {
    const drawingContext = context()
    const node: SceneChartNode = { id: 'el_chart', kind: 'chart', bounds: { x: 0, y: 0, w: 200, h: 100 } }

    paintChartNode(drawingContext, node, { scale: 2, offsetX: 0, offsetY: 0 })

    expect(drawingContext.calls.rects).toEqual([[0, 0, 400, 200]]) // panel, bounds scaled by 2
    expect(drawingContext.calls.strokeRects).toEqual([[0, 0, 400, 200]]) // dashed border
    expect(drawingContext.calls.texts.map((args) => args[0])).toContain('图表') // placeholder label
  })

  it('draws one filled rect per laid-out bar when primitives are present', () => {
    const drawingContext = context()
    const node: SceneChartNode = {
      id: 'el_chart',
      kind: 'chart',
      bounds: { x: 0, y: 0, w: 200, h: 100 },
      primitives: {
        bars: [{ x: 10, y: 50, w: 20, h: 30, color: '#FF0000', seriesIndex: 0, categoryIndex: 0 }, { x: 40, y: 20, w: 20, h: 60, color: '#00FF00', seriesIndex: 0, categoryIndex: 1 }],
        axes: [{ x1: 0, y1: 0, x2: 0, y2: 100 }],
        gridlines: [],
        labels: [{ text: 'A', x: 20, y: 100, align: 'center', baseline: 'top', role: 'category' }],
      },
    }

    paintChartNode(drawingContext, node, { scale: 2, offsetX: 0, offsetY: 0 })

    expect(drawingContext.calls.rects).toEqual([[20, 100, 40, 60], [80, 40, 40, 120]]) // bars mapped by scale 2
    expect(drawingContext.calls.strokeRects).toHaveLength(0) // no placeholder border
    expect(drawingContext.calls.texts.map((args) => args[0])).toEqual(['A']) // the category label, not 图表
  })
})

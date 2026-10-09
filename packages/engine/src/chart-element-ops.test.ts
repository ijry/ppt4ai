import { describe, expect, it } from 'vitest'
import { EditorEngine } from './index'
import type { Ppt4aiDocument } from '@ppt4ai/model'

// A shape (el_a) and a chart (el_chart) on one slide. Phase 0 keeps the chart first-class for the
// generic, kind-agnostic operations — select / move / resize / rotate / flip / z-order / delete — even
// though its data is not modeled and it paints as a placeholder.
function chartDocument(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_chart_ops',
    page: { w: 10000000, h: 6000000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_a', 'el_chart'] } },
    elements: {
      el_a: { id: 'el_a', kind: 'shape', preset: 'rect', bounds: { x: 1000000, y: 1000000, w: 1000000, h: 1000000 } },
      el_chart: { id: 'el_chart', kind: 'chart', bounds: { x: 4000000, y: 1000000, w: 3000000, h: 2000000 }, chartRelId: 'rId2' },
    },
    slideOrder: ['sld_1'],
  }
}

describe('chart element is first-class for generic ops', () => {
  it('selects a chart', () => {
    const engine = new EditorEngine(chartDocument())
    expect(engine.dispatch({ type: 'select', elementIds: ['el_chart'] }).selection).toEqual(['el_chart'])
  })

  it('moves a selected chart by a delta', () => {
    const engine = new EditorEngine(chartDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_chart'] })
    const state = engine.dispatch({ type: 'move', dx: 500000, dy: -200000 })
    expect(state.document.elements.el_chart!.bounds).toMatchObject({ x: 4500000, y: 800000 })
  })

  it('resizes a chart', () => {
    const engine = new EditorEngine(chartDocument())
    const state = engine.dispatch({ type: 'resize', elementId: 'el_chart', bounds: { x: 4000000, y: 1000000, w: 3500000, h: 2500000 } })
    expect(state.document.elements.el_chart!.bounds).toMatchObject({ w: 3500000, h: 2500000 })
  })

  it('rotates and flips a chart', () => {
    const engine = new EditorEngine(chartDocument())
    expect(engine.dispatch({ type: 'setElementRotation', elementId: 'el_chart', rotation: 2700000 }).document.elements.el_chart).toMatchObject({ rotation: 2700000 })
    expect(engine.dispatch({ type: 'toggleElementFlip', elementId: 'el_chart', axis: 'horizontal' }).document.elements.el_chart).toMatchObject({ flipH: true })
  })

  it('reorders a chart with z-order', () => {
    const engine = new EditorEngine(chartDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_chart'] })
    expect(engine.dispatch({ type: 'zOrder', action: 'back' }).document.slides.sld_1!.elementIds).toEqual(['el_chart', 'el_a'])
  })

  it('deletes a chart', () => {
    const engine = new EditorEngine(chartDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_chart'] })
    const state = engine.dispatch({ type: 'deleteElements', elementIds: ['el_chart'] })
    expect(state.document.elements.el_chart).toBeUndefined()
    expect(state.document.slides.sld_1!.elementIds).toEqual(['el_a'])
  })

  it('edits chart data (categories + series) and can undo it', () => {
    const engine = new EditorEngine(chartDocument())
    const state = engine.dispatch({ type: 'setChartData', elementId: 'el_chart', categories: ['X', 'Y', 'Z'], series: [{ name: 'S', values: [1, 2, 3] }] })
    expect(state.document.elements.el_chart).toMatchObject({ categories: ['X', 'Y', 'Z'], series: [{ name: 'S', values: [1, 2, 3] }] })
    expect(engine.dispatch({ type: 'undo' }).document.elements.el_chart).not.toHaveProperty('categories')
  })

  it('changes the chart type', () => {
    const engine = new EditorEngine(chartDocument())
    expect(engine.dispatch({ type: 'setChartType', elementId: 'el_chart', chartType: 'line' }).document.elements.el_chart).toMatchObject({ chartType: 'line' })
  })

  it('rejects chart-data edits on a non-chart element', () => {
    const engine = new EditorEngine(chartDocument())
    expect(() => engine.dispatch({ type: 'setChartData', elementId: 'el_a', categories: [], series: [] })).toThrow('element is not a chart: el_a')
  })
})

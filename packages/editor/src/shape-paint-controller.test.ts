import { EditorEngine } from '@ppt4ai/engine'
import type { Element, Fill, Ppt4aiDocument, Theme } from '@ppt4ai/model'
import { documentToSceneGraph } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { createShapePaintController } from './shape-paint-controller'

const bounds = { x: 0, y: 0, w: 2000000, h: 1000000 }

const theme: Theme = {
  id: 'thm_1',
  colors: { accent1: { type: 'srgb', v: '4472C4' }, accent2: { type: 'srgb', v: 'ED7D31' } },
  formatScheme: {
    fillStyles: [{ color: { type: 'scheme', v: 'phClr' } }],
    lineStyles: [{ color: { type: 'scheme', v: 'phClr' }, width: 6350, style: 'dash' }],
  },
}

function documentWith(...elements: Element[]): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_paint_controller',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: elements.map((element) => element.id), layoutId: 'lyt_1' } },
    slideOrder: ['sld_1'],
    elements: Object.fromEntries(elements.map((element) => [element.id, element])),
    layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } },
    masters: { mst_1: { id: 'mst_1', themeId: 'thm_1' } },
    themes: { thm_1: theme },
  }
}

const navy: Fill = { color: { type: 'srgb', v: '203864' } }

const ramp: Fill = {
  color: { type: 'srgb', v: '4472C4' },
  gradient: {
    stops: [
      { pos: 0, color: { type: 'srgb', v: '4472C4' } },
      { pos: 100000, color: { type: 'srgb', v: 'ED7D31' } },
    ],
  },
}

function shape(overrides: Partial<Extract<Element, { kind: 'shape' }>> = {}): Element {
  return { id: 'el_shape', kind: 'shape', preset: 'rect', bounds, ...overrides }
}

function controllerFor(...elements: Element[]) {
  const engine = new EditorEngine(documentWith(...elements))
  const controller = createShapePaintController({ engine })
  const scene = () => documentToSceneGraph(engine.getState().document)
  return { engine, controller, scene }
}

describe('shape paint controller target', () => {
  it('targets a single selected shape or text element', () => {
    const { engine, controller } = controllerFor(shape())
    engine.dispatch({ type: 'select', elementIds: ['el_shape'] })

    expect(controller.target()).toBe('el_shape')
  })

  it('has no target without a selection', () => {
    const { controller } = controllerFor(shape())

    expect(controller.target()).toBeUndefined()
    expect(controller.props().active).toBe(false)
  })

  /** The commands are element-scoped, so a multi-selection disables rather than editing the first. */
  it('has no target for a multi-selection', () => {
    const { engine, controller } = controllerFor(shape(), shape({ id: 'el_other' }))
    engine.dispatch({ type: 'select', elementIds: ['el_shape', 'el_other'] })

    expect(controller.target()).toBeUndefined()
  })

  it('has no target for a kind that cannot carry paint', () => {
    const { engine, controller } = controllerFor(
      { id: 'el_image', kind: 'image', bounds, assetId: 'asset-1' },
      { id: 'el_group', kind: 'group', bounds, childIds: [] },
    )

    for (const elementId of ['el_image', 'el_group']) {
      engine.dispatch({ type: 'select', elementIds: [elementId] })
      expect(controller.target()).toBeUndefined()
    }
  })
})

describe('shape paint controller display model', () => {
  it('shows the element own paint', () => {
    const { engine, controller, scene } = controllerFor(shape({ fill: navy, stroke: navy, strokeWidth: 76200, strokeStyle: 'dot' }))
    engine.dispatch({ type: 'select', elementIds: ['el_shape'] })

    expect(controller.props(scene())).toEqual({
      active: true,
      fillColor: '#203864',
      fillIsGradient: false,
      strokeColor: '#203864',
      strokeIsGradient: false,
      strokeWidth: 76200,
      strokeStyle: 'dot',
    })
  })

  /**
   * The case reading the element's own fields would get wrong: a gallery shape carries no fill of
   * its own, so the swatch has to come from the scene or it would show white over a blue shape.
   */
  it('shows the colour the theme style matrix resolved', () => {
    const { engine, controller, scene } = controllerFor(shape({
      styleRef: {
        fill: { idx: 1, color: { type: 'scheme', v: 'accent1' } },
        line: { idx: 1, color: { type: 'scheme', v: 'accent2' } },
      },
    }))
    engine.dispatch({ type: 'select', elementIds: ['el_shape'] })
    const props = controller.props(scene())

    expect(props.fillColor).toBe('#4472C4')
    expect(props.strokeColor).toBe('#ED7D31')
  })

  /** The width and dash the theme line entry supplies are the effective values, so they show. */
  it('shows the width and dash inherited from the theme line entry', () => {
    const { engine, controller, scene } = controllerFor(shape({
      styleRef: { line: { idx: 1, color: { type: 'scheme', v: 'accent2' } } },
    }))
    engine.dispatch({ type: 'select', elementIds: ['el_shape'] })
    const props = controller.props(scene())

    expect(props.strokeWidth).toBe(6350)
    expect(props.strokeStyle).toBe('dash')
  })

  it('marks a gradient fill and outline', () => {
    const { engine, controller, scene } = controllerFor(shape({ fill: ramp, stroke: ramp }))
    engine.dispatch({ type: 'select', elementIds: ['el_shape'] })
    const props = controller.props(scene())

    expect(props.fillIsGradient).toBe(true)
    expect(props.strokeIsGradient).toBe(true)
  })

  it('leaves the width absent when nothing supplies one', () => {
    const { engine, controller, scene } = controllerFor(shape({ fill: navy }))
    engine.dispatch({ type: 'select', elementIds: ['el_shape'] })

    expect(controller.props(scene())).not.toHaveProperty('strokeWidth')
  })

  /** Without a scene the controller still reports the element's own width and dash. */
  it('falls back to the element fields with no scene', () => {
    const { engine, controller } = controllerFor(shape({ strokeWidth: 12700, strokeStyle: 'dash' }))
    engine.dispatch({ type: 'select', elementIds: ['el_shape'] })
    const props = controller.props()

    expect(props.strokeWidth).toBe(12700)
    expect(props.strokeStyle).toBe('dash')
    expect(props.fillColor).toBe('#FFFFFF')
  })
})

describe('shape paint controller commands', () => {
  it('dispatches each of the four commands', () => {
    const { engine, controller } = controllerFor(shape({ fill: navy, stroke: navy }))
    engine.dispatch({ type: 'select', elementIds: ['el_shape'] })

    controller.setFill({ color: { type: 'srgb', v: 'FF0000' } })
    controller.setStroke({ color: { type: 'srgb', v: '00FF00' } })
    controller.setStrokeWidth(76200)
    controller.setStrokeStyle('dot')

    const element = engine.getState().document.elements.el_shape
    if (element?.kind !== 'shape') throw new Error('fixture did not keep a shape')
    expect(element.fill).toEqual({ color: { type: 'srgb', v: 'FF0000' } })
    expect(element.stroke).toEqual({ color: { type: 'srgb', v: '00FF00' } })
    expect(element.strokeWidth).toBe(76200)
    expect(element.strokeStyle).toBe('dot')
  })

  it('clears each property with null', () => {
    const { engine, controller } = controllerFor(shape({ fill: navy, stroke: navy, strokeWidth: 12700, strokeStyle: 'dash' }))
    engine.dispatch({ type: 'select', elementIds: ['el_shape'] })

    controller.setFill(null)
    controller.setStroke(null)
    controller.setStrokeWidth(null)
    controller.setStrokeStyle(null)

    const element = engine.getState().document.elements.el_shape
    if (element?.kind !== 'shape') throw new Error('fixture did not keep a shape')
    expect(element).not.toHaveProperty('fill')
    expect(element).not.toHaveProperty('stroke')
    expect(element).not.toHaveProperty('strokeWidth')
    expect(element).not.toHaveProperty('strokeStyle')
  })

  it('refuses every setter without a single editable target', () => {
    const { controller } = controllerFor(shape())

    expect(() => controller.setFill(navy)).toThrow('a single shape or text element must be selected')
    expect(() => controller.setStroke(navy)).toThrow('a single shape or text element must be selected')
    expect(() => controller.setStrokeWidth(12700)).toThrow('a single shape or text element must be selected')
    expect(() => controller.setStrokeStyle('dot')).toThrow('a single shape or text element must be selected')
  })

  /** The scene has to reflect the edit, not just the model field. */
  it('changes what the scene resolves', () => {
    const { engine, controller, scene } = controllerFor(shape({ fill: navy }))
    engine.dispatch({ type: 'select', elementIds: ['el_shape'] })
    const before = scene().nodes[0]
    if (before?.kind !== 'shape') throw new Error('fixture did not build a shape node')
    expect(before.resolvedFillColor).toEqual({ rgb: '203864', alpha: 100000 })

    controller.setFill({ color: { type: 'srgb', v: 'FF0000' } })

    const after = scene().nodes[0]
    if (after?.kind !== 'shape') throw new Error('fixture did not build a shape node')
    expect(after.resolvedFillColor).toEqual({ rgb: 'FF0000', alpha: 100000 })
  })
})

import type { Element, Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { EditorEngine } from './index'

function documentWith(...elements: Element[]): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_stroke_commands',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: elements.map((element) => element.id) } },
    slideOrder: ['sld_1'],
    elements: Object.fromEntries(elements.map((element) => [element.id, element])),
  }
}

const bounds = { x: 0, y: 0, w: 2000000, h: 1000000 }

function outlinedShape(overrides: Partial<Extract<Element, { kind: 'shape' }>> = {}): Element {
  return {
    id: 'el_shape',
    kind: 'shape',
    preset: 'rect',
    bounds,
    stroke: { color: { type: 'srgb', v: '203864' } },
    strokeWidth: 12700,
    strokeStyle: 'dash',
    ...overrides,
  }
}

/** `exactOptionalPropertyTypes` rejects `strokeWidth: undefined`, so the field is deleted instead. */
function withoutWidth(): Element {
  const shape = outlinedShape()
  if (shape.kind !== 'shape') throw new Error('fixture is not a shape')
  delete shape.strokeWidth
  return shape
}

function engineWith(...elements: Element[]): EditorEngine {
  return new EditorEngine(documentWith(...elements))
}

function shapeOf(engine: EditorEngine) {
  const element = engine.getState().document.elements.el_shape
  if (element?.kind !== 'shape') throw new Error('fixture did not keep a shape')
  return element
}

describe('setElementStrokeWidth', () => {
  it('sets a width and undoes it', () => {
    const engine = engineWith(outlinedShape())

    engine.dispatch({ type: 'setElementStrokeWidth', elementId: 'el_shape', width: 76200 })
    expect(shapeOf(engine).strokeWidth).toBe(76200)

    engine.dispatch({ type: 'undo' })
    expect(shapeOf(engine).strokeWidth).toBe(12700)
  })

  /** `w="0"` is an explicit hairline in OOXML, so zero must survive as a value. */
  it('keeps a zero width rather than treating it as a clear', () => {
    const engine = engineWith(outlinedShape())

    engine.dispatch({ type: 'setElementStrokeWidth', elementId: 'el_shape', width: 0 })

    expect(shapeOf(engine).strokeWidth).toBe(0)
    expect('strokeWidth' in shapeOf(engine)).toBe(true)
  })

  /** `null` deletes the field, which is what the exporter reads as "remove the attribute". */
  it('clears the width on null and restores it on undo', () => {
    const engine = engineWith(outlinedShape())

    engine.dispatch({ type: 'setElementStrokeWidth', elementId: 'el_shape', width: null })
    expect(shapeOf(engine)).not.toHaveProperty('strokeWidth')

    engine.dispatch({ type: 'undo' })
    expect(shapeOf(engine).strokeWidth).toBe(12700)
  })

  it('sets a width on an element that had none', () => {
    const engine = engineWith(withoutWidth())

    engine.dispatch({ type: 'setElementStrokeWidth', elementId: 'el_shape', width: 19050 })

    expect(shapeOf(engine).strokeWidth).toBe(19050)
  })

  it('rejects a non-integer or negative width', () => {
    const engine = engineWith(outlinedShape())

    expect(() => engine.dispatch({ type: 'setElementStrokeWidth', elementId: 'el_shape', width: 1.5 }))
      .toThrow('stroke width must be a non-negative integer')
    expect(() => engine.dispatch({ type: 'setElementStrokeWidth', elementId: 'el_shape', width: -1 }))
      .toThrow('stroke width must be a non-negative integer')
    expect(shapeOf(engine).strokeWidth).toBe(12700)
  })

  /** Otherwise a toolbar would stack an undo entry every time the same value is picked. */
  it('does not touch the history when the width is unchanged', () => {
    const engine = engineWith(outlinedShape())
    const before = engine.getState().history.undoDepth

    engine.dispatch({ type: 'setElementStrokeWidth', elementId: 'el_shape', width: 12700 })

    expect(engine.getState().history.undoDepth).toBe(before)
  })

  it('does not touch the history when clearing an already absent width', () => {
    const engine = engineWith(withoutWidth())
    const before = engine.getState().history.undoDepth

    engine.dispatch({ type: 'setElementStrokeWidth', elementId: 'el_shape', width: null })

    expect(engine.getState().history.undoDepth).toBe(before)
  })
})

describe('setElementStrokeStyle', () => {
  it('sets each modeled style', () => {
    const engine = engineWith(outlinedShape())

    for (const style of ['solid', 'dot', 'dash'] as const) {
      engine.dispatch({ type: 'setElementStrokeStyle', elementId: 'el_shape', style })
      expect(shapeOf(engine).strokeStyle).toBe(style)
    }
  })

  it('clears the style on null and restores it on undo', () => {
    const engine = engineWith(outlinedShape())

    engine.dispatch({ type: 'setElementStrokeStyle', elementId: 'el_shape', style: null })
    expect(shapeOf(engine)).not.toHaveProperty('strokeStyle')

    engine.dispatch({ type: 'undo' })
    expect(shapeOf(engine).strokeStyle).toBe('dash')
  })

  /**
   * `lgDashDot` used to be refused here — the model could not hold it. Now the eleven `a:prstDash`
   * tokens are all settable (the toolbar still offers three), and only a word that is not one is refused.
   */
  it('accepts every preset dash token and rejects a word that is not one', () => {
    const engine = engineWith(outlinedShape())

    engine.dispatch({ type: 'setElementStrokeStyle', elementId: 'el_shape', style: 'lgDashDot' })
    expect(shapeOf(engine).strokeStyle).toBe('lgDashDot')

    expect(() => engine.dispatch({
      type: 'setElementStrokeStyle',
      elementId: 'el_shape',
      style: 'squiggle' as never,
    })).toThrow('stroke style is invalid')
    expect(shapeOf(engine).strokeStyle).toBe('lgDashDot')
  })

  it('does not touch the history when the style is unchanged', () => {
    const engine = engineWith(outlinedShape())
    const before = engine.getState().history.undoDepth

    engine.dispatch({ type: 'setElementStrokeStyle', elementId: 'el_shape', style: 'dash' })

    expect(engine.getState().history.undoDepth).toBe(before)
  })
})

describe('outline commands refuse elements that cannot carry one', () => {
  it('sets the width on a text element', () => {
    const engine = engineWith({
      id: 'el_shape',
      kind: 'text',
      bounds,
      body: { paragraphs: [{ runs: [{ text: 'Label' }] }] },
      stroke: { color: { type: 'srgb', v: '203864' } },
    })

    engine.dispatch({ type: 'setElementStrokeWidth', elementId: 'el_shape', width: 38100 })

    const element = engine.getState().document.elements.el_shape
    if (element?.kind !== 'text') throw new Error('fixture did not keep a text element')
    expect(element.strokeWidth).toBe(38100)
  })

  it('rejects a table, an image and a group with a stable error', () => {
    const engine = new EditorEngine(documentWith(
      { id: 'el_table', kind: 'table', bounds, columns: [bounds.w], rows: [{ height: bounds.h, cells: [{ column: 0, body: { paragraphs: [] } }] }] },
      { id: 'el_image', kind: 'image', bounds, assetId: 'asset-1' },
      { id: 'el_group', kind: 'group', bounds, childIds: [] },
    ))

    for (const elementId of ['el_table', 'el_image', 'el_group']) {
      expect(() => engine.dispatch({ type: 'setElementStrokeWidth', elementId, width: 12700 }))
        .toThrow(`element cannot carry an outline: ${elementId}`)
      expect(() => engine.dispatch({ type: 'setElementStrokeStyle', elementId, style: 'dot' }))
        .toThrow(`element cannot carry an outline: ${elementId}`)
    }
  })

  it('rejects an element that does not exist', () => {
    const engine = engineWith(outlinedShape())

    expect(() => engine.dispatch({ type: 'setElementStrokeWidth', elementId: 'nope', width: 12700 }))
      .toThrow('element does not exist: nope')
  })
})

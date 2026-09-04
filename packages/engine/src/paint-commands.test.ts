import type { Element, Fill, Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { EditorEngine } from './index'

function documentWith(...elements: Element[]): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_paint_commands',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: elements.map((element) => element.id) } },
    slideOrder: ['sld_1'],
    elements: Object.fromEntries(elements.map((element) => [element.id, element])),
  }
}

const bounds = { x: 0, y: 0, w: 2000000, h: 1000000 }

const navy: Fill = { color: { type: 'srgb', v: '203864' } }
const red: Fill = { color: { type: 'srgb', v: 'FF0000' } }

const ramp: Fill = {
  color: { type: 'srgb', v: '4472C4' },
  gradient: {
    stops: [
      { pos: 0, color: { type: 'srgb', v: '4472C4' } },
      { pos: 100000, color: { type: 'srgb', v: 'ED7D31' } },
    ],
    angle: 0,
  },
}

function paintedShape(overrides: Partial<Extract<Element, { kind: 'shape' }>> = {}): Element {
  return { id: 'el_shape', kind: 'shape', preset: 'rect', bounds, fill: navy, stroke: navy, ...overrides }
}

function engineWith(...elements: Element[]): EditorEngine {
  return new EditorEngine(documentWith(...elements))
}

function shapeOf(engine: EditorEngine) {
  const element = engine.getState().document.elements.el_shape
  if (element?.kind !== 'shape') throw new Error('fixture did not keep a shape')
  return element
}

describe('setElementFill', () => {
  it('sets a fill and undoes it', () => {
    const engine = engineWith(paintedShape())

    engine.dispatch({ type: 'setElementFill', elementId: 'el_shape', fill: red })
    expect(shapeOf(engine).fill).toEqual(red)

    engine.dispatch({ type: 'undo' })
    expect(shapeOf(engine).fill).toEqual(navy)
  })

  it('sets a gradient fill', () => {
    const engine = engineWith(paintedShape())

    engine.dispatch({ type: 'setElementFill', elementId: 'el_shape', fill: ramp })

    expect(shapeOf(engine).fill).toEqual(ramp)
  })

  /** Picking a solid colour replaces the whole paint, which is what dropping the ramp means. */
  it('replaces a gradient with a flat colour', () => {
    const engine = engineWith(paintedShape({ fill: ramp }))

    engine.dispatch({ type: 'setElementFill', elementId: 'el_shape', fill: red })

    expect(shapeOf(engine).fill).toEqual(red)
    expect(shapeOf(engine).fill).not.toHaveProperty('gradient')
  })

  it('clears the fill on null and restores it on undo', () => {
    const engine = engineWith(paintedShape())

    engine.dispatch({ type: 'setElementFill', elementId: 'el_shape', fill: null })
    expect(shapeOf(engine)).not.toHaveProperty('fill')

    engine.dispatch({ type: 'undo' })
    expect(shapeOf(engine).fill).toEqual(navy)
  })

  /** The command is the first path that can put a malformed paint on an element. */
  it('rejects a malformed colour with a stable error', () => {
    const engine = engineWith(paintedShape())

    expect(() => engine.dispatch({
      type: 'setElementFill',
      elementId: 'el_shape',
      fill: { color: { type: 'nope', v: 'x' } } as never,
    })).toThrow('element fill is invalid: el_shape')
    expect(shapeOf(engine).fill).toEqual(navy)
  })

  it('rejects a gradient with fewer than two stops', () => {
    const engine = engineWith(paintedShape())

    expect(() => engine.dispatch({
      type: 'setElementFill',
      elementId: 'el_shape',
      fill: { color: { type: 'srgb', v: '4472C4' }, gradient: { stops: [{ pos: 0, color: { type: 'srgb', v: '4472C4' } }] } },
    })).toThrow('element fill is invalid: el_shape')
  })

  it('does not touch the history when the fill is unchanged', () => {
    const engine = engineWith(paintedShape())
    const before = engine.getState().history.undoDepth

    engine.dispatch({ type: 'setElementFill', elementId: 'el_shape', fill: { color: { type: 'srgb', v: '203864' } } })

    expect(engine.getState().history.undoDepth).toBe(before)
  })

  /** A stored paint must not alias the caller's object, or later mutation would bypass history. */
  it('clones the paint it stores', () => {
    const engine = engineWith(paintedShape())
    const supplied: Fill = { color: { type: 'srgb', v: 'FF0000' } }

    engine.dispatch({ type: 'setElementFill', elementId: 'el_shape', fill: supplied })
    supplied.color.v = '00FF00'

    expect(shapeOf(engine).fill?.color.v).toBe('FF0000')
  })
})

describe('setElementStroke', () => {
  it('sets an outline colour and undoes it', () => {
    const engine = engineWith(paintedShape())

    engine.dispatch({ type: 'setElementStroke', elementId: 'el_shape', stroke: red })
    expect(shapeOf(engine).stroke).toEqual(red)

    engine.dispatch({ type: 'undo' })
    expect(shapeOf(engine).stroke).toEqual(navy)
  })

  /**
   * Only safe now that gradient outlines paint: before that this command could set a value the
   * canvas silently rendered as the first stop.
   */
  it('sets a gradient outline', () => {
    const engine = engineWith(paintedShape())

    engine.dispatch({ type: 'setElementStroke', elementId: 'el_shape', stroke: ramp })

    expect(shapeOf(engine).stroke).toEqual(ramp)
  })

  it('clears the outline on null', () => {
    const engine = engineWith(paintedShape())

    engine.dispatch({ type: 'setElementStroke', elementId: 'el_shape', stroke: null })

    expect(shapeOf(engine)).not.toHaveProperty('stroke')
  })

  it('leaves the width and dash alone', () => {
    const engine = engineWith(paintedShape({ strokeWidth: 76200, strokeStyle: 'dash' }))

    engine.dispatch({ type: 'setElementStroke', elementId: 'el_shape', stroke: red })

    expect(shapeOf(engine).strokeWidth).toBe(76200)
    expect(shapeOf(engine).strokeStyle).toBe('dash')
  })

  it('does not touch the history when the outline is unchanged', () => {
    const engine = engineWith(paintedShape())
    const before = engine.getState().history.undoDepth

    engine.dispatch({ type: 'setElementStroke', elementId: 'el_shape', stroke: { color: { type: 'srgb', v: '203864' } } })

    expect(engine.getState().history.undoDepth).toBe(before)
  })
})

describe('paint commands refuse elements that cannot carry paint', () => {
  it('sets the fill on a text element', () => {
    const engine = engineWith({
      id: 'el_shape',
      kind: 'text',
      bounds,
      body: { paragraphs: [{ runs: [{ text: 'Label' }] }] },
    })

    engine.dispatch({ type: 'setElementFill', elementId: 'el_shape', fill: red })

    const element = engine.getState().document.elements.el_shape
    if (element?.kind !== 'text') throw new Error('fixture did not keep a text element')
    expect(element.fill).toEqual(red)
  })

  it('rejects a table, an image and a group', () => {
    const engine = new EditorEngine(documentWith(
      { id: 'el_table', kind: 'table', bounds, columns: [bounds.w], rows: [{ height: bounds.h, cells: [{ column: 0, body: { paragraphs: [] } }] }] },
      { id: 'el_image', kind: 'image', bounds, assetId: 'asset-1' },
      { id: 'el_group', kind: 'group', bounds, childIds: [] },
    ))

    for (const elementId of ['el_table', 'el_image', 'el_group']) {
      expect(() => engine.dispatch({ type: 'setElementFill', elementId, fill: red }))
        .toThrow(`element cannot carry an outline: ${elementId}`)
      expect(() => engine.dispatch({ type: 'setElementStroke', elementId, stroke: red }))
        .toThrow(`element cannot carry an outline: ${elementId}`)
    }
  })

  it('rejects an element that does not exist', () => {
    const engine = engineWith(paintedShape())

    expect(() => engine.dispatch({ type: 'setElementFill', elementId: 'nope', fill: red }))
      .toThrow('element does not exist: nope')
  })
})

/** A picture fill needs its asset in the document, which the fills above have no reason to carry. */
function pictureFilledEngine(overrides: Partial<Extract<Element, { kind: 'shape' }>> = {}): EditorEngine {
  return new EditorEngine({
    ...documentWith({ id: 'el_shape', kind: 'shape', preset: 'rect', bounds, stroke: navy, pictureFill: { assetId: 'asset_photo' }, ...overrides }),
    assets: { asset_photo: { id: 'asset_photo', mimeType: 'image/png' } },
  })
}

describe('setElementFill on a picture-filled shape', () => {
  it('replaces the picture with the colour', () => {
    const engine = pictureFilledEngine()

    engine.dispatch({ type: 'setElementFill', elementId: 'el_shape', fill: red })

    expect(shapeOf(engine).fill).toEqual(red)
    expect(shapeOf(engine).pictureFill).toBeUndefined()
  })

  it('clears the picture when the fill is removed altogether', () => {
    const engine = pictureFilledEngine()

    engine.dispatch({ type: 'setElementFill', elementId: 'el_shape', fill: null })

    expect(shapeOf(engine).fill).toBeUndefined()
    expect(shapeOf(engine).pictureFill).toBeUndefined()
  })

  /** One commit, so the colour and the picture it replaced come back together. */
  it('restores both on a single undo', () => {
    const engine = pictureFilledEngine()

    engine.dispatch({ type: 'setElementFill', elementId: 'el_shape', fill: red })
    engine.dispatch({ type: 'undo' })

    expect(shapeOf(engine).pictureFill).toEqual({ assetId: 'asset_photo' })
    expect(shapeOf(engine).fill).toBeUndefined()
  })

  /**
   * The no-op guard has to look past the colour: a shape whose colour already matches still has a
   * picture to clear, and returning early there would leave the canvas painting the photo.
   */
  it('clears the picture even when the colour is unchanged', () => {
    const engine = pictureFilledEngine({ fill: red })

    engine.dispatch({ type: 'setElementFill', elementId: 'el_shape', fill: red })

    expect(shapeOf(engine).fill).toEqual(red)
    expect(shapeOf(engine).pictureFill).toBeUndefined()
  })

  it('leaves the picture alone when only the outline changes', () => {
    const engine = pictureFilledEngine()

    engine.dispatch({ type: 'setElementStroke', elementId: 'el_shape', stroke: red })

    expect(shapeOf(engine).stroke).toEqual(red)
    expect(shapeOf(engine).pictureFill).toEqual({ assetId: 'asset_photo' })
  })
})

import { describe, expect, it } from 'vitest'
import type { Ppt4aiDocument } from '@ppt4ai/model'
import { EditorEngine } from './index'

/** Two shapes side by side, matching the rotateSelection fixture so the two can be compared. */
function pairDocument(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_multi_flip',
    page: { w: 20000000, h: 12000000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_a', 'el_b'] } },
    elements: {
      el_a: { id: 'el_a', kind: 'shape', preset: 'rect', bounds: { x: 1000000, y: 1000000, w: 2000000, h: 2000000 } },
      el_b: { id: 'el_b', kind: 'shape', preset: 'rect', bounds: { x: 3000000, y: 1000000, w: 2000000, h: 2000000 } },
    },
    slideOrder: ['sld_1'],
  }
}

describe('flipSelection', () => {
  it('flips every selected element about its own centre, leaving bounds alone', () => {
    const engine = new EditorEngine(pairDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })
    const before = engine.getState().document

    const state = engine.dispatch({ type: 'flipSelection', axis: 'horizontal' })

    expect(state.document.elements.el_a).toEqual({ ...before.elements.el_a, flipH: true })
    expect(state.document.elements.el_b).toEqual({ ...before.elements.el_b, flipH: true })
  })

  it('toggles each element independently, so an already-flipped one comes back', () => {
    const document = pairDocument()
    const shape = document.elements.el_a
    if (shape?.kind !== 'shape') throw new Error('fixture el_a is not a shape')
    shape.flipH = true
    const engine = new EditorEngine(document)
    engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })

    const state = engine.dispatch({ type: 'flipSelection', axis: 'horizontal' })

    expect(state.document.elements.el_a).not.toHaveProperty('flipH')
    expect(state.document.elements.el_b).toMatchObject({ flipH: true })
  })

  it('flips each axis independently', () => {
    const engine = new EditorEngine(pairDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })
    engine.dispatch({ type: 'flipSelection', axis: 'horizontal' })

    const state = engine.dispatch({ type: 'flipSelection', axis: 'vertical' })

    expect(state.document.elements.el_a).toMatchObject({ flipH: true, flipV: true })
  })

  it('matches a single-element flip when only one element is selected', () => {
    const viaSelection = new EditorEngine(pairDocument())
    viaSelection.dispatch({ type: 'select', elementIds: ['el_a'] })
    const selectionResult = viaSelection.dispatch({ type: 'flipSelection', axis: 'vertical' })

    const viaElement = new EditorEngine(pairDocument())
    const elementResult = viaElement.dispatch({ type: 'toggleElementFlip', elementId: 'el_a', axis: 'vertical' })

    expect(selectionResult.document.elements.el_a).toEqual(elementResult.document.elements.el_a)
  })

  it('routes an image through its nested transform', () => {
    const document = pairDocument()
    document.elements.el_b = { id: 'el_b', kind: 'image', bounds: { x: 3000000, y: 1000000, w: 2000000, h: 2000000 }, assetId: 'asset_1' }
    document.assets = { asset_1: { id: 'asset_1', mimeType: 'image/png' } }
    const engine = new EditorEngine(document)
    engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })

    const state = engine.dispatch({ type: 'flipSelection', axis: 'horizontal' })

    expect(state.document.elements.el_b).toMatchObject({ transform: { flipH: true } })
    expect(state.document.elements.el_b).not.toHaveProperty('flipH')
  })

  it('flips a selected group on its own field and lets the cascade carry descendants', () => {
    const document = pairDocument()
    document.elements.grp_1 = {
      id: 'grp_1',
      kind: 'group',
      bounds: { x: 1000000, y: 1000000, w: 2000000, h: 2000000 },
      childIds: ['el_a'],
    }
    document.slides.sld_1!.elementIds = ['grp_1', 'el_a', 'el_b']
    const engine = new EditorEngine(document)
    engine.dispatch({ type: 'select', elementIds: ['grp_1', 'el_b'] })
    const before = engine.getState().document

    const state = engine.dispatch({ type: 'flipSelection', axis: 'horizontal' })

    expect(state.document.elements.grp_1).toMatchObject({ flipH: true })
    // A descendant is not touched: the group's flip reaches it through the scene cascade.
    expect(state.document.elements.el_a).toEqual(before.elements.el_a)
  })

  it('skips a descendant that is selected alongside its own group', () => {
    const document = pairDocument()
    document.elements.grp_1 = {
      id: 'grp_1',
      kind: 'group',
      bounds: { x: 1000000, y: 1000000, w: 2000000, h: 2000000 },
      childIds: ['el_a'],
    }
    document.slides.sld_1!.elementIds = ['grp_1', 'el_a', 'el_b']
    const engine = new EditorEngine(document)
    engine.dispatch({ type: 'select', elementIds: ['grp_1', 'el_a'] })
    const before = engine.getState().document

    const state = engine.dispatch({ type: 'flipSelection', axis: 'horizontal' })

    // Flipping both would cancel out, because the cascade already mirrors el_a.
    expect(state.document.elements.grp_1).toMatchObject({ flipH: true })
    expect(state.document.elements.el_a).toEqual(before.elements.el_a)
  })

  it('commits one history entry for the whole selection', () => {
    const engine = new EditorEngine(pairDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })
    const before = engine.getState()

    const state = engine.dispatch({ type: 'flipSelection', axis: 'horizontal' })
    expect(state.history.undoDepth).toBe(before.history.undoDepth + 1)

    expect(engine.dispatch({ type: 'undo' }).document.elements.el_a).toEqual(before.document.elements.el_a)
    expect(engine.getState().document.elements.el_b).toEqual(before.document.elements.el_b)
  })

  it('rejects an unsupported axis without touching the document', () => {
    const engine = new EditorEngine(pairDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })
    const before = engine.getState()

    expect(() => engine.dispatch({ type: 'flipSelection', axis: 'diagonal' as never })).toThrow('unsupported element flip axis: diagonal')
    expect(engine.getState().document).toEqual(before.document)
    expect(engine.getState().history).toEqual(before.history)
  })

  it('does nothing when the selection is empty', () => {
    const engine = new EditorEngine(pairDocument())
    const before = engine.getState()

    const state = engine.dispatch({ type: 'flipSelection', axis: 'horizontal' })

    expect(state.document).toEqual(before.document)
    expect(state.history).toEqual(before.history)
  })
})

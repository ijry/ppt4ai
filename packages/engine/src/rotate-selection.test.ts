import { describe, expect, it } from 'vitest'
import { documentToSceneGraph } from '@ppt4ai/render'
import type { Ppt4aiDocument } from '@ppt4ai/model'
import { EditorEngine } from './index'

const quarterTurn = 5400000

/** Two shapes side by side; their union centre is (3000000, 2000000). */
function pairDocument(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_multi_rotate',
    page: { w: 20000000, h: 12000000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_a', 'el_b'] } },
    elements: {
      el_a: { id: 'el_a', kind: 'shape', preset: 'rect', bounds: { x: 1000000, y: 1000000, w: 2000000, h: 2000000 } },
      el_b: { id: 'el_b', kind: 'shape', preset: 'rect', bounds: { x: 3000000, y: 1000000, w: 2000000, h: 2000000 } },
    },
    slideOrder: ['sld_1'],
  }
}

function nodeBounds(document: Ppt4aiDocument, id: string) {
  const node = documentToSceneGraph(document).nodes.find((entry) => entry.id === id)
  if (!node) throw new Error(`node ${id} missing`)
  return node.bounds
}

describe('rotateSelection', () => {
  it('rotates every selected element about the union centre', () => {
    const engine = new EditorEngine(pairDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })

    const state = engine.dispatch({ type: 'rotateSelection', rotation: quarterTurn })

    // Union centre is (3000000, 2000000). A quarter turn clockwise sends el_a's centre
    // (2000000, 2000000) to (3000000, 1000000) and el_b's (4000000, 2000000) to (3000000, 3000000).
    expect(state.document.elements.el_a?.bounds).toEqual({ x: 2000000, y: 0, w: 2000000, h: 2000000 })
    expect(state.document.elements.el_b?.bounds).toEqual({ x: 2000000, y: 2000000, w: 2000000, h: 2000000 })
    expect(state.document.elements.el_a).toMatchObject({ rotation: quarterTurn })
    expect(state.document.elements.el_b).toMatchObject({ rotation: quarterTurn })
  })

  it('adds to a rotation the element already had', () => {
    const document = pairDocument()
    const shape = document.elements.el_a
    if (shape?.kind !== 'shape') throw new Error('fixture el_a is not a shape')
    shape.rotation = 900000
    const engine = new EditorEngine(document)
    engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })

    const state = engine.dispatch({ type: 'rotateSelection', rotation: quarterTurn })

    expect(state.document.elements.el_a).toMatchObject({ rotation: quarterTurn + 900000 })
    expect(state.document.elements.el_b).toMatchObject({ rotation: quarterTurn })
  })

  it('behaves like a single-element rotation about its own centre when one element is selected', () => {
    const engine = new EditorEngine(pairDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_a'] })
    const before = engine.getState().document.elements.el_a?.bounds

    const state = engine.dispatch({ type: 'rotateSelection', rotation: quarterTurn })

    expect(state.document.elements.el_a?.bounds).toEqual(before)
    expect(state.document.elements.el_a).toMatchObject({ rotation: quarterTurn })
  })

  it('routes an image through its nested transform', () => {
    const document = pairDocument()
    document.elements.el_b = { id: 'el_b', kind: 'image', bounds: { x: 3000000, y: 1000000, w: 2000000, h: 2000000 }, assetId: 'asset_1' }
    document.assets = { asset_1: { id: 'asset_1', mimeType: 'image/png' } }
    const engine = new EditorEngine(document)
    engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })

    const state = engine.dispatch({ type: 'rotateSelection', rotation: quarterTurn })

    expect(state.document.elements.el_b).toMatchObject({ transform: { rotation: quarterTurn } })
    expect(state.document.elements.el_b).not.toHaveProperty('rotation')
  })

  it('commits one history entry for the whole selection', () => {
    const engine = new EditorEngine(pairDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })
    const before = engine.getState()

    const state = engine.dispatch({ type: 'rotateSelection', rotation: quarterTurn })
    expect(state.history.undoDepth).toBe(before.history.undoDepth + 1)

    expect(engine.dispatch({ type: 'undo' }).document.elements.el_a).toEqual(before.document.elements.el_a)
    expect(engine.getState().document.elements.el_b).toEqual(before.document.elements.el_b)
  })

  it('rotates a whole group and lets the cascade carry its descendants', () => {
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

    const state = engine.dispatch({ type: 'rotateSelection', rotation: quarterTurn })

    expect(state.document.elements.grp_1).toMatchObject({ rotation: quarterTurn })
    // The descendant keeps its own stored rotation; the group's angle reaches it via the cascade.
    expect(state.document.elements.el_a).not.toHaveProperty('rotation')
    expect(nodeBounds(state.document, 'el_a')).toEqual({ x: 2000000, y: 0, w: 2000000, h: 2000000 })
  })

  it('rejects a non-integer rotation without touching the document', () => {
    const engine = new EditorEngine(pairDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })
    const before = engine.getState()

    expect(() => engine.dispatch({ type: 'rotateSelection', rotation: 1.5 })).toThrow('rotation must be an integer')
    expect(engine.getState().document).toEqual(before.document)
    expect(engine.getState().history).toEqual(before.history)
  })

  it('does nothing when the selection is empty', () => {
    const engine = new EditorEngine(pairDocument())
    const before = engine.getState()

    const state = engine.dispatch({ type: 'rotateSelection', rotation: quarterTurn })

    expect(state.document).toEqual(before.document)
    expect(state.history).toEqual(before.history)
  })

  it('adds no history for a zero rotation', () => {
    const engine = new EditorEngine(pairDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })
    const before = engine.getState()

    const state = engine.dispatch({ type: 'rotateSelection', rotation: 0 })

    expect(state.document).toEqual(before.document)
    expect(state.history).toEqual(before.history)
  })
})

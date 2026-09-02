import { describe, expect, it } from 'vitest'
import { documentToSceneGraph } from '@ppt4ai/render'
import type { Ppt4aiDocument } from '@ppt4ai/model'
import { EditorEngine } from './index'

const quarterTurn = 5400000

/** Two leaves inside a rotated group, so ungroup has to preserve a visible transform. */
function rotatedGroupDocument(options: { rotation?: number; childSpace?: { x: number; y: number; w: number; h: number }; leafRotation?: number } = {}): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_ungroup',
    page: { w: 20000000, h: 12000000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['grp_1', 'el_a', 'el_b'] } },
    elements: {
      grp_1: {
        id: 'grp_1',
        kind: 'group',
        bounds: { x: 1000000, y: 1000000, w: 4000000, h: 2000000 },
        childIds: ['el_a', 'el_b'],
        ...(options.rotation === undefined ? {} : { rotation: options.rotation }),
        ...(options.childSpace ? { childSpace: options.childSpace } : {}),
      },
      el_a: {
        id: 'el_a',
        kind: 'shape',
        preset: 'rect',
        bounds: { x: 1000000, y: 1000000, w: 2000000, h: 2000000 },
        ...(options.leafRotation === undefined ? {} : { rotation: options.leafRotation }),
      },
      el_b: { id: 'el_b', kind: 'shape', preset: 'rect', bounds: { x: 3000000, y: 1000000, w: 2000000, h: 2000000 } },
    },
    slideOrder: ['sld_1'],
  }
}

function sceneNode(document: Ppt4aiDocument, id: string) {
  const node = documentToSceneGraph(document).nodes.find((entry) => entry.id === id)
  if (!node) throw new Error(`node ${id} missing from scene`)
  return node
}

describe('ungroup preserves the visible result', () => {
  it('bakes the group rotation into each former child', () => {
    const engine = new EditorEngine(rotatedGroupDocument({ rotation: quarterTurn }))
    const before = sceneNode(engine.getState().document, 'el_a')

    const state = engine.dispatch({ type: 'ungroup', groupId: 'grp_1' })
    const after = sceneNode(state.document, 'el_a')

    expect(state.document.elements.grp_1).toBeUndefined()
    expect(after.bounds.x).toBeCloseTo(before.bounds.x, 6)
    expect(after.bounds.y).toBeCloseTo(before.bounds.y, 6)
    expect(after.bounds.w).toBeCloseTo(before.bounds.w, 6)
    expect(after.bounds.h).toBeCloseTo(before.bounds.h, 6)
    expect(after.transform?.rotation).toBe(before.transform?.rotation)
  })

  it('adds the group rotation to a child that already had one', () => {
    const engine = new EditorEngine(rotatedGroupDocument({ rotation: quarterTurn, leafRotation: 900000 }))
    const state = engine.dispatch({ type: 'ungroup', groupId: 'grp_1' })

    expect(state.document.elements.el_a).toMatchObject({ rotation: quarterTurn + 900000 })
  })

  it('bakes a child space mapping into the former children', () => {
    const engine = new EditorEngine(rotatedGroupDocument({ childSpace: { x: 1000000, y: 1000000, w: 8000000, h: 4000000 } }))
    const before = sceneNode(engine.getState().document, 'el_b')

    const state = engine.dispatch({ type: 'ungroup', groupId: 'grp_1' })
    const after = sceneNode(state.document, 'el_b')

    expect(after.bounds.x).toBeCloseTo(before.bounds.x, 6)
    expect(after.bounds.y).toBeCloseTo(before.bounds.y, 6)
    expect(after.bounds.w).toBeCloseTo(before.bounds.w, 6)
    expect(after.bounds.h).toBeCloseTo(before.bounds.h, 6)
  })

  it('bakes rotation and child space together', () => {
    const engine = new EditorEngine(rotatedGroupDocument({
      rotation: quarterTurn,
      childSpace: { x: 1000000, y: 1000000, w: 8000000, h: 4000000 },
    }))
    const before = sceneNode(engine.getState().document, 'el_a')

    const state = engine.dispatch({ type: 'ungroup', groupId: 'grp_1' })
    const after = sceneNode(state.document, 'el_a')

    expect(after.bounds.x).toBeCloseTo(before.bounds.x, 6)
    expect(after.bounds.y).toBeCloseTo(before.bounds.y, 6)
    expect(after.transform?.rotation).toBe(before.transform?.rotation)
  })

  it('leaves children untouched when the group has no transform', () => {
    const engine = new EditorEngine(rotatedGroupDocument())
    const before = engine.getState().document

    const state = engine.dispatch({ type: 'ungroup', groupId: 'grp_1' })

    expect(state.document.elements.el_a).toEqual(before.elements.el_a)
    expect(state.document.elements.el_b).toEqual(before.elements.el_b)
  })

  it('restores the original children in one undo', () => {
    const engine = new EditorEngine(rotatedGroupDocument({ rotation: quarterTurn }))
    const before = engine.getState().document

    engine.dispatch({ type: 'ungroup', groupId: 'grp_1' })
    const undone = engine.dispatch({ type: 'undo' }).document

    expect(undone.elements.el_a).toEqual(before.elements.el_a)
    expect(undone.elements.el_b).toEqual(before.elements.el_b)
    expect(undone.elements.grp_1).toEqual(before.elements.grp_1)
  })

  it('bakes an outer rotation through a nested group down onto the leaves', () => {
    const document = rotatedGroupDocument({ rotation: quarterTurn })
    const outer = document.elements.grp_1
    if (outer?.kind !== 'group') throw new Error('expected a group')
    outer.childIds = ['grp_2']
    document.elements.grp_2 = {
      id: 'grp_2',
      kind: 'group',
      bounds: { x: 1000000, y: 1000000, w: 3000000, h: 2000000 },
      childIds: ['el_a'],
    }
    // Off-centre inside grp_2, so the outer pivot and grp_2's own centre cannot coincide.
    document.elements.el_a!.bounds = { x: 1000000, y: 1000000, w: 1000000, h: 1000000 }
    document.slides.sld_1!.elementIds = ['grp_1', 'grp_2', 'el_a', 'el_b']

    const engine = new EditorEngine(document)
    const before = sceneNode(engine.getState().document, 'el_a')
    const state = engine.dispatch({ type: 'ungroup', groupId: 'grp_1' })
    const after = sceneNode(state.document, 'el_a')
    const nested = state.document.elements.grp_2
    if (nested?.kind !== 'group') throw new Error('expected the nested group to survive')

    // The rotation lands on the leaf, not on grp_2: a group rotates about its own centre, so
    // pushing the outer angle onto grp_2 would use the wrong pivot for an off-centre child.
    expect(nested.rotation).toBeUndefined()
    expect(state.document.elements.el_a).toMatchObject({ rotation: quarterTurn })
    expect(after.bounds.x).toBeCloseTo(before.bounds.x, 6)
    expect(after.bounds.y).toBeCloseTo(before.bounds.y, 6)
    expect(after.transform?.rotation).toBe(before.transform?.rotation)
  })
})

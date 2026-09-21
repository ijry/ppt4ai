import { describe, expect, it } from 'vitest'
import { documentToSceneGraph } from '@ppt4ai/render'
import type { Ppt4aiDocument } from '@ppt4ai/model'
import { EditorEngine } from './index'

/** A group PowerPoint resized: children are authored in a 2:1 child space. */
function scaledGroupDocument(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_child_space',
    page: { w: 20000000, h: 12000000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['grp_1', 'el_1'] } },
    elements: {
      grp_1: {
        id: 'grp_1',
        kind: 'group',
        bounds: { x: 1000000, y: 2000000, w: 2000000, h: 1000000 },
        childIds: ['el_1'],
        childSpace: { x: 5000000, y: 6000000, w: 4000000, h: 2000000 },
      },
      el_1: { id: 'el_1', kind: 'shape', preset: 'rect', bounds: { x: 5000000, y: 6000000, w: 4000000, h: 2000000 } },
    },
    slideOrder: ['sld_1'],
  }
}

function leafBounds(document: Ppt4aiDocument) {
  const node = documentToSceneGraph(document).nodes.find((entry) => entry.id === 'el_1')
  if (!node) throw new Error('leaf missing from scene')
  return node.bounds
}

describe('editing a group that declares a child space', () => {
  it('renders the child filling the group before any edit', () => {
    expect(leafBounds(scaledGroupDocument())).toEqual({ x: 1000000, y: 2000000, w: 2000000, h: 1000000 })
  })

  it('keeps the child filling the group after the group is resized', () => {
    const engine = new EditorEngine(scaledGroupDocument())
    const state = engine.dispatch({ type: 'resize', elementId: 'grp_1', bounds: { x: 1000000, y: 2000000, w: 4000000, h: 2000000 } })

    expect(state.document.elements.grp_1?.bounds).toEqual({ x: 1000000, y: 2000000, w: 4000000, h: 2000000 })
    expect(leafBounds(state.document)).toEqual({ x: 1000000, y: 2000000, w: 4000000, h: 2000000 })
  })

  it('keeps the child filling the group after the group is moved', () => {
    const engine = new EditorEngine(scaledGroupDocument())
    engine.dispatch({ type: 'select', elementIds: ['grp_1'] })
    const state = engine.dispatch({ type: 'move', dx: 1000000, dy: 0 })

    expect(state.document.elements.grp_1?.bounds).toMatchObject({ x: 2000000, y: 2000000 })
    expect(leafBounds(state.document)).toEqual({ x: 2000000, y: 2000000, w: 2000000, h: 1000000 })
  })

  it('leaves descendant bounds in their authored child space, so the mapping is applied once', () => {
    const engine = new EditorEngine(scaledGroupDocument())
    const before = engine.getState().document.elements.el_1?.bounds
    const state = engine.dispatch({ type: 'resize', elementId: 'grp_1', bounds: { x: 1000000, y: 2000000, w: 4000000, h: 2000000 } })

    expect(state.document.elements.el_1?.bounds).toEqual(before)
  })

  it('still maps descendants of a group without a child space', () => {
    const document = scaledGroupDocument()
    const group = document.elements.grp_1
    if (group?.kind !== 'group') throw new Error('expected a group')
    delete group.childSpace
    document.elements.el_1!.bounds = { x: 1000000, y: 2000000, w: 2000000, h: 1000000 }

    const engine = new EditorEngine(document)
    const state = engine.dispatch({ type: 'resize', elementId: 'grp_1', bounds: { x: 1000000, y: 2000000, w: 4000000, h: 2000000 } })

    expect(state.document.elements.el_1?.bounds).toEqual({ x: 1000000, y: 2000000, w: 4000000, h: 2000000 })
    expect(leafBounds(state.document)).toEqual({ x: 1000000, y: 2000000, w: 4000000, h: 2000000 })
  })

  it('keeps a nested group inside a child space untouched while the outer group scales', () => {
    const document = scaledGroupDocument()
    const outer = document.elements.grp_1
    if (outer?.kind !== 'group') throw new Error('expected a group')
    outer.childIds = ['grp_2']
    document.elements.grp_2 = {
      id: 'grp_2',
      kind: 'group',
      bounds: { x: 5000000, y: 6000000, w: 4000000, h: 2000000 },
      childIds: ['el_1'],
    }
    document.slides.sld_1!.elementIds = ['grp_1', 'grp_2', 'el_1']

    const engine = new EditorEngine(document)
    const before = engine.getState().document
    const state = engine.dispatch({ type: 'resize', elementId: 'grp_1', bounds: { x: 1000000, y: 2000000, w: 4000000, h: 2000000 } })

    expect(state.document.elements.grp_2?.bounds).toEqual(before.elements.grp_2?.bounds)
    expect(state.document.elements.el_1?.bounds).toEqual(before.elements.el_1?.bounds)
    expect(leafBounds(state.document)).toEqual({ x: 1000000, y: 2000000, w: 4000000, h: 2000000 })
  })

  it('keeps childSpace as imported when the group is resized, so content scales with the box', () => {
    const engine = new EditorEngine(scaledGroupDocument())
    const state = engine.dispatch({ type: 'resize', elementId: 'grp_1', bounds: { x: 1000000, y: 2000000, w: 4000000, h: 2000000 } })
    const group = state.document.elements.grp_1
    if (group?.kind !== 'group') throw new Error('expected a group')

    // Scaling childSpace alongside bounds would hold the ext:chExt ratio fixed, which is the
    // scale factor -- the box would grow while its contents stayed put.
    expect(group.childSpace).toEqual({ x: 5000000, y: 6000000, w: 4000000, h: 2000000 })
  })

  it('keeps a half-covering child at half the resized group', () => {
    const document = scaledGroupDocument()
    document.elements.el_1!.bounds = { x: 5000000, y: 6000000, w: 2000000, h: 1000000 }
    const engine = new EditorEngine(document)

    const state = engine.dispatch({ type: 'resize', elementId: 'grp_1', bounds: { x: 1000000, y: 2000000, w: 4000000, h: 2000000 } })

    expect(leafBounds(state.document)).toEqual({ x: 1000000, y: 2000000, w: 2000000, h: 1000000 })
  })

  it('leaves childSpace origin alone when the group only moves', () => {
    const engine = new EditorEngine(scaledGroupDocument())
    engine.dispatch({ type: 'select', elementIds: ['grp_1'] })
    const state = engine.dispatch({ type: 'move', dx: 1000000, dy: 0 })
    const group = state.document.elements.grp_1
    if (group?.kind !== 'group') throw new Error('expected a group')

    expect(group.childSpace).toEqual({ x: 5000000, y: 6000000, w: 4000000, h: 2000000 })
  })

  it('does not invent a childSpace for a group that had none', () => {
    const document = scaledGroupDocument()
    const group = document.elements.grp_1
    if (group?.kind !== 'group') throw new Error('expected a group')
    delete group.childSpace
    const engine = new EditorEngine(document)

    const state = engine.dispatch({ type: 'resize', elementId: 'grp_1', bounds: { x: 1000000, y: 2000000, w: 4000000, h: 2000000 } })
    const resized = state.document.elements.grp_1
    if (resized?.kind !== 'group') throw new Error('expected a group')

    expect(resized.childSpace).toBeUndefined()
  })

  it('keeps childSpace as imported for a multi-selection resize as well', () => {
    const engine = new EditorEngine(scaledGroupDocument())
    engine.dispatch({ type: 'select', elementIds: ['grp_1'] })
    const state = engine.dispatch({ type: 'resizeSelection', bounds: { x: 1000000, y: 2000000, w: 4000000, h: 2000000 } })
    const group = state.document.elements.grp_1
    if (group?.kind !== 'group') throw new Error('expected a group')

    expect(group.childSpace).toEqual({ x: 5000000, y: 6000000, w: 4000000, h: 2000000 })
    expect(leafBounds(state.document)).toEqual({ x: 1000000, y: 2000000, w: 4000000, h: 2000000 })
  })
})

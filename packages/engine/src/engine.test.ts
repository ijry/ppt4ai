import { describe, expect, it } from 'vitest'
import { EditorEngine } from './index'
import type { Ppt4aiDocument } from '@ppt4ai/model'

function makeDocument(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_engine',
    page: { w: 10000000, h: 6000000 },
    slides: {
      sld_1: { id: 'sld_1', elementIds: ['el_a', 'el_b'] },
    },
    elements: {
      el_a: {
        id: 'el_a',
        kind: 'shape',
        preset: 'rect',
        bounds: { x: 1000000, y: 1000000, w: 1000000, h: 1000000 },
      },
      el_b: {
        id: 'el_b',
        kind: 'shape',
        preset: 'ellipse',
        bounds: { x: 4000000, y: 1000000, w: 1000000, h: 1000000 },
      },
    },
    slideOrder: ['sld_1'],
  }
}

describe('EditorEngine', () => {
  it('keeps selection separate from document history and clones state safely', () => {
    const engine = new EditorEngine(makeDocument())

    expect(engine.dispatch({ type: 'select', elementIds: ['el_a'] }).selection).toEqual(['el_a'])
    expect(engine.dispatch({ type: 'undo' }).selection).toEqual(['el_a'])
    expect(engine.getState().history).toEqual({ undoDepth: 0, redoDepth: 0 })
    expect(structuredClone(engine.getState())).toEqual(engine.getState())

    const state = engine.getState()
    state.document.elements.el_a!.bounds.x = 999
    expect(engine.getState().document.elements.el_a!.bounds.x).toBe(1000000)
  })

  it('supports additive selection while deduplicating and filtering missing elements', () => {
    const engine = new EditorEngine(makeDocument())

    expect(engine.dispatch({ type: 'select', elementIds: ['el_a', 'missing'] }).selection).toEqual(['el_a'])
    expect(engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'], additive: true }).selection).toEqual(['el_a', 'el_b'])
  })

  it('moves selected bounds and snaps to another element edge', () => {
    const engine = new EditorEngine(makeDocument(), { snap: { threshold: 100000 } })
    engine.dispatch({ type: 'select', elementIds: ['el_a'] })
    const state = engine.dispatch({ type: 'move', dx: 1900000, dy: 0 })

    expect(state.document.elements.el_a?.bounds.x).toBe(3000000)
    expect(state.guides).toEqual([
      { axis: 'x', position: 4000000, source: 'element', elementId: 'el_b' },
      { axis: 'y', position: 1000000, source: 'element', elementId: 'el_b' },
    ])
    expect(state.history).toEqual({ undoDepth: 1, redoDepth: 0 })
    expect(engine.dispatch({ type: 'undo' }).document.elements.el_a?.bounds.x).toBe(1000000)
    expect(engine.dispatch({ type: 'redo' }).document.elements.el_a?.bounds.x).toBe(3000000)
  })

  it('resizes one element and rejects non-positive bounds', () => {
    const engine = new EditorEngine(makeDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_a'] })
    expect(engine.dispatch({ type: 'resize', elementId: 'el_a', bounds: { x: 2, y: 3, w: 4, h: 5 } }).document.elements.el_a?.bounds).toEqual({ x: 2, y: 3, w: 4, h: 5 })
    expect(() => engine.dispatch({ type: 'resize', elementId: 'el_a', bounds: { x: 2, y: 3, w: 0, h: 5 } })).toThrow('bounds must be positive')
    expect(engine.getState().history.undoDepth).toBe(1)
  })

  it('changes z-order while preserving selected relative order', () => {
    const engine = new EditorEngine(makeDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_a'] })
    expect(engine.dispatch({ type: 'zOrder', action: 'front' }).document.slides.sld_1?.elementIds).toEqual(['el_b', 'el_a'])
    expect(engine.dispatch({ type: 'zOrder', action: 'back' }).document.slides.sld_1?.elementIds).toEqual(['el_a', 'el_b'])
  })

  it('undoes and redoes z-order changes without changing selection', () => {
    const engine = new EditorEngine(makeDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_a'] })
    engine.dispatch({ type: 'zOrder', action: 'front' })

    expect(engine.dispatch({ type: 'undo' }).document.slides.sld_1?.elementIds).toEqual(['el_a', 'el_b'])
    expect(engine.getState().selection).toEqual(['el_a'])
    expect(engine.dispatch({ type: 'redo' }).document.slides.sld_1?.elementIds).toEqual(['el_b', 'el_a'])
  })

  it('groups selected elements and restores order on undo and ungroup', () => {
    const engine = new EditorEngine(makeDocument(), { idFactory: () => 'grp_1' })
    engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })
    engine.dispatch({ type: 'group' })
    expect(engine.getState().document.slides.sld_1?.elementIds).toEqual(['grp_1'])
    expect(engine.getState().document.elements.grp_1).toMatchObject({ kind: 'group', childIds: ['el_a', 'el_b'] })
    engine.dispatch({ type: 'ungroup', groupId: 'grp_1' })
    expect(engine.getState().document.slides.sld_1?.elementIds).toEqual(['el_a', 'el_b'])
    expect(engine.getState().document.elements.grp_1).toBeUndefined()
  })

  it('generates deterministic group ids per engine session', () => {
    const engine = new EditorEngine(makeDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })
    engine.dispatch({ type: 'group' })

    expect(engine.getState().document.elements.grp_1).toMatchObject({ kind: 'group' })
  })

  it('removes deleted elements from selection during history replay', () => {
    const engine = new EditorEngine(makeDocument(), { idFactory: () => 'grp_1' })
    engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })
    engine.dispatch({ type: 'group' })
    expect(engine.getState().selection).toEqual(['grp_1'])

    expect(engine.dispatch({ type: 'undo' }).selection).toEqual([])
  })

  it('undoes grouping and redoes ungrouping', () => {
    const engine = new EditorEngine(makeDocument(), { idFactory: () => 'grp_1' })
    engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })
    engine.dispatch({ type: 'group' })

    expect(engine.dispatch({ type: 'undo' }).document.slides.sld_1?.elementIds).toEqual(['el_a', 'el_b'])
    expect(engine.getState().document.elements.grp_1).toBeUndefined()
    engine.dispatch({ type: 'redo' })
    engine.dispatch({ type: 'ungroup', groupId: 'grp_1' })
    expect(engine.dispatch({ type: 'undo' }).document.elements.grp_1).toMatchObject({ kind: 'group' })
    expect(engine.dispatch({ type: 'redo' }).document.elements.grp_1).toBeUndefined()
  })

  it('does not add no-op commands to history', () => {
    const engine = new EditorEngine(makeDocument())
    engine.dispatch({ type: 'select', elementIds: ['el_a'] })

    expect(engine.dispatch({ type: 'move', dx: 0, dy: 0 }).history).toEqual({ undoDepth: 0, redoDepth: 0 })
    expect(engine.dispatch({ type: 'zOrder', action: 'front' }).history).toEqual({ undoDepth: 1, redoDepth: 0 })
    expect(engine.dispatch({ type: 'zOrder', action: 'front' }).history).toEqual({ undoDepth: 1, redoDepth: 0 })
  })
})

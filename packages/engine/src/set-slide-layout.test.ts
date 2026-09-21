import type { Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { EditorEngine } from './index'

function documentWith(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_layout',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [], layoutId: 'lyt_a', masterId: 'mst_1' } },
    slideOrder: ['sld_1'],
    elements: {},
    layouts: {
      lyt_a: { id: 'lyt_a', masterId: 'mst_1' },
      lyt_b: { id: 'lyt_b', masterId: 'mst_1' },
      lyt_other: { id: 'lyt_other', masterId: 'mst_2' },
    },
    masters: { mst_1: { id: 'mst_1' }, mst_2: { id: 'mst_2' } },
  }
}

const layoutOf = (engine: EditorEngine): string | undefined => engine.getState().document.slides.sld_1?.layoutId

describe('setSlideLayout', () => {
  it('switches a slide to another layout under the same master and undoes it', () => {
    const engine = new EditorEngine(documentWith())

    engine.dispatch({ type: 'setSlideLayout', slideId: 'sld_1', layoutId: 'lyt_b' })
    expect(layoutOf(engine)).toBe('lyt_b')

    engine.dispatch({ type: 'undo' })
    expect(layoutOf(engine)).toBe('lyt_a')
  })

  it('rejects a layout under a different master', () => {
    const engine = new EditorEngine(documentWith())
    expect(() => engine.dispatch({ type: 'setSlideLayout', slideId: 'sld_1', layoutId: 'lyt_other' })).toThrow(/different master/)
  })

  it('throws for a missing slide or layout', () => {
    const engine = new EditorEngine(documentWith())
    expect(() => engine.dispatch({ type: 'setSlideLayout', slideId: 'nope', layoutId: 'lyt_b' })).toThrow(/slide does not exist/)
    expect(() => engine.dispatch({ type: 'setSlideLayout', slideId: 'sld_1', layoutId: 'nope' })).toThrow(/layout does not exist/)
  })

  it('is a no-op when the slide already uses the layout', () => {
    const engine = new EditorEngine(documentWith())
    const before = engine.getState().history.undoDepth
    engine.dispatch({ type: 'setSlideLayout', slideId: 'sld_1', layoutId: 'lyt_a' })
    expect(engine.getState().history.undoDepth).toBe(before)
  })
})

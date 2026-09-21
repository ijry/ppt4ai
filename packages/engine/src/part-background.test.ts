import type { Ppt4aiDocument, SlideBackground } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { EditorEngine } from './index'

function documentWith(masterBg?: SlideBackground, layoutBg?: SlideBackground): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_part_bg',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [], layoutId: 'lyt_1' } },
    slideOrder: ['sld_1'],
    elements: {},
    layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1', ...(layoutBg ? { background: layoutBg } : {}) } },
    masters: { mst_1: { id: 'mst_1', ...(masterBg ? { background: masterBg } : {}) } },
  }
}

const navy: SlideBackground = { fill: { color: { type: 'srgb', v: '1F3864' } } }
const red: SlideBackground = { fill: { color: { type: 'srgb', v: 'FF0000' } } }

describe('setMasterBackground', () => {
  it('sets a master background and undoes it', () => {
    const engine = new EditorEngine(documentWith())

    engine.dispatch({ type: 'setMasterBackground', masterId: 'mst_1', background: navy })
    expect(engine.getState().document.masters?.mst_1?.background).toEqual(navy)

    engine.dispatch({ type: 'undo' })
    expect(engine.getState().document.masters?.mst_1?.background).toBeUndefined()
  })

  it('clears the master background on null', () => {
    const engine = new EditorEngine(documentWith(navy))

    engine.dispatch({ type: 'setMasterBackground', masterId: 'mst_1', background: null })
    expect(engine.getState().document.masters?.mst_1).not.toHaveProperty('background')
  })

  it('throws for a missing master', () => {
    const engine = new EditorEngine(documentWith())
    expect(() => engine.dispatch({ type: 'setMasterBackground', masterId: 'nope', background: navy })).toThrow(/master does not exist/)
  })
})

describe('setLayoutBackground', () => {
  it('sets a layout background and undoes it', () => {
    const engine = new EditorEngine(documentWith())

    engine.dispatch({ type: 'setLayoutBackground', layoutId: 'lyt_1', background: red })
    expect(engine.getState().document.layouts?.lyt_1?.background).toEqual(red)

    engine.dispatch({ type: 'undo' })
    expect(engine.getState().document.layouts?.lyt_1?.background).toBeUndefined()
  })

  it('clears the layout background on null', () => {
    const engine = new EditorEngine(documentWith(undefined, red))

    engine.dispatch({ type: 'setLayoutBackground', layoutId: 'lyt_1', background: null })
    expect(engine.getState().document.layouts?.lyt_1).not.toHaveProperty('background')
  })

  it('throws for a missing layout', () => {
    const engine = new EditorEngine(documentWith())
    expect(() => engine.dispatch({ type: 'setLayoutBackground', layoutId: 'nope', background: red })).toThrow(/layout does not exist/)
  })
})

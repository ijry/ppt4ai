import type { Ppt4aiDocument, SlideBackground } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { EditorEngine } from './index'

function documentWith(background?: SlideBackground): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_background',
    page: { w: 12192000, h: 6858000 },
    slides: {
      sld_1: { id: 'sld_1', elementIds: [], ...(background ? { background } : {}) },
      sld_2: { id: 'sld_2', elementIds: [] },
    },
    slideOrder: ['sld_1', 'sld_2'],
    elements: {},
  }
}

const navy: SlideBackground = { fill: { color: { type: 'srgb', v: '1F3864' } } }
const red: SlideBackground = { fill: { color: { type: 'srgb', v: 'FF0000' } } }

function backgroundOf(engine: EditorEngine, slideId = 'sld_1'): SlideBackground | undefined {
  return engine.getState().document.slides[slideId]?.background
}

describe('setSlideBackground', () => {
  it('sets a background and undoes it', () => {
    const engine = new EditorEngine(documentWith())

    engine.dispatch({ type: 'setSlideBackground', slideId: 'sld_1', background: navy })
    expect(backgroundOf(engine)).toEqual(navy)

    engine.dispatch({ type: 'undo' })
    expect(backgroundOf(engine)).toBeUndefined()
  })

  /** `null` removes the slide's own background, so resolution falls back to the layout and master. */
  it('clears the background on null and restores it on undo', () => {
    const engine = new EditorEngine(documentWith(navy))

    engine.dispatch({ type: 'setSlideBackground', slideId: 'sld_1', background: null })
    expect(engine.getState().document.slides.sld_1).not.toHaveProperty('background')

    engine.dispatch({ type: 'undo' })
    expect(backgroundOf(engine)).toEqual(navy)
  })

  it('replaces one background with another and touches only that slide', () => {
    const engine = new EditorEngine(documentWith(navy))

    engine.dispatch({ type: 'setSlideBackground', slideId: 'sld_1', background: red })

    expect(backgroundOf(engine)).toEqual(red)
    expect(backgroundOf(engine, 'sld_2')).toBeUndefined()
  })

  it('sets a gradient background', () => {
    const engine = new EditorEngine(documentWith())
    const ramp: SlideBackground = {
      fill: {
        color: { type: 'srgb', v: '1F3864' },
        gradient: {
          stops: [{ pos: 0, color: { type: 'srgb', v: '1F3864' } }, { pos: 100000, color: { type: 'srgb', v: 'FFFFFF' } }],
          angle: 5400000,
        },
      },
    }

    engine.dispatch({ type: 'setSlideBackground', slideId: 'sld_1', background: ramp })

    expect(backgroundOf(engine)).toEqual(ramp)
  })

  it('does not touch the history when the background is unchanged', () => {
    const engine = new EditorEngine(documentWith(navy))
    const before = engine.getState().history.undoDepth

    engine.dispatch({ type: 'setSlideBackground', slideId: 'sld_1', background: { fill: { color: { type: 'srgb', v: '1F3864' } } } })

    expect(engine.getState().history.undoDepth).toBe(before)
  })

  it('rejects a slide that does not exist', () => {
    const engine = new EditorEngine(documentWith())

    expect(() => engine.dispatch({ type: 'setSlideBackground', slideId: 'nope', background: navy }))
      .toThrow('slide does not exist: nope')
  })

  it('rejects a malformed background and leaves the document alone', () => {
    const engine = new EditorEngine(documentWith(navy))

    expect(() => engine.dispatch({
      type: 'setSlideBackground',
      slideId: 'sld_1',
      background: { fill: { color: { type: 'nope', v: 'x' } } } as never,
    })).toThrow('slide background is invalid: sld_1')
    expect(backgroundOf(engine)).toEqual(navy)
  })

  /** A stored background must not alias the caller's object, or later mutation would bypass history. */
  it('clones the background it stores', () => {
    const engine = new EditorEngine(documentWith())
    const supplied: SlideBackground = { fill: { color: { type: 'srgb', v: 'FF0000' } } }

    engine.dispatch({ type: 'setSlideBackground', slideId: 'sld_1', background: supplied })
    supplied.fill!.color.v = '00FF00'

    expect(backgroundOf(engine)?.fill?.color.v).toBe('FF0000')
  })

  it('sets a background style reference', () => {
    const engine = new EditorEngine(documentWith())

    engine.dispatch({ type: 'setSlideBackground', slideId: 'sld_1', background: { styleRef: { idx: 1001 } } })

    expect(backgroundOf(engine)).toEqual({ styleRef: { idx: 1001 } })
  })
})

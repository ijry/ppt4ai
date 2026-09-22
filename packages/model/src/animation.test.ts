import { describe, expect, it } from 'vitest'
import { validateDocument, type Ppt4aiDocument, type SlideTimeline } from './index'

function documentWith(animations?: Record<string, SlideTimeline>): Ppt4aiDocument {
  return {
    format: 'ppt4ai', version: 1, id: 'dck_anim', page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_1'] } },
    slideOrder: ['sld_1'],
    elements: { el_1: { id: 'el_1', kind: 'shape', bounds: { x: 0, y: 0, w: 100, h: 100 }, preset: 'rect' } },
    ...(animations ? { animations } : {}),
  }
}

describe('animation timeline validation', () => {
  it('accepts a well-formed main sequence', () => {
    const doc = documentWith({
      sld_1: { mainSeq: [{ trigger: 'onClick', items: [{ targetId: 'el_1', class: 'entrance', preset: 'fade', presetId: 10, duration: 500, params: { direction: 'fromBottom' } }] }] },
    })
    expect(validateDocument(doc)).toEqual({ valid: true })
  })

  it('rejects an item targeting a missing element', () => {
    const doc = documentWith({ sld_1: { mainSeq: [{ trigger: 'onClick', items: [{ targetId: 'nope', class: 'entrance', preset: 'fade' }] }] } })
    const result = validateDocument(doc)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors.some((e) => e.includes('targetId must reference an element'))).toBe(true)
  })

  it('rejects an unknown trigger and class', () => {
    const bad = documentWith({ sld_1: { mainSeq: [{ trigger: 'whenever' as never, items: [{ targetId: 'el_1', class: 'spin' as never, preset: 'fade' }] }] } })
    const result = validateDocument(bad)
    expect(result.valid).toBe(false)
  })

  it('rejects a timeline on a missing slide', () => {
    const doc = documentWith({ sld_missing: { mainSeq: [] } })
    const result = validateDocument(doc)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors.some((e) => e.includes('references missing slide'))).toBe(true)
  })

  it('rejects non-string params values and negative durations', () => {
    const doc = documentWith({ sld_1: { mainSeq: [{ trigger: 'onClick', items: [{ targetId: 'el_1', class: 'entrance', preset: 'fade', duration: -1, params: { direction: 5 as never } }] }] } })
    const result = validateDocument(doc)
    expect(result.valid).toBe(false)
  })

  it('accepts a document with no animations at all', () => {
    expect(validateDocument(documentWith())).toEqual({ valid: true })
  })

  it('accepts an interactive build whose triggerId references an element', () => {
    const doc = documentWith({
      sld_1: {
        mainSeq: [],
        interactiveSeq: [{ trigger: 'onClick', triggerId: 'el_1', items: [{ targetId: 'el_1', class: 'entrance', preset: 'fade' }] }],
      },
    })
    expect(validateDocument(doc)).toEqual({ valid: true })
  })

  it('rejects an interactive build whose triggerId points at a missing element', () => {
    const doc = documentWith({
      sld_1: {
        mainSeq: [],
        interactiveSeq: [{ trigger: 'onClick', triggerId: 'nope', items: [{ targetId: 'el_1', class: 'entrance', preset: 'fade' }] }],
      },
    })
    const result = validateDocument(doc)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors.some((e) => e.includes('triggerId must reference an element'))).toBe(true)
  })
})

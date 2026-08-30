import { describe, expect, it } from 'vitest'
import { createPlaygroundPresentationHost } from './presentation-host'

describe('createPlaygroundPresentationHost', () => {
  it('starts with ordered editable pages and page-scoped thumbnail scenes', () => {
    const host = createPlaygroundPresentationHost()
    const snapshot = host.getSnapshot()

    expect(snapshot.slideOrder).toEqual(['sld_playground', 'sld_playground_blue'])
    expect(snapshot.activeSlideId).toBe('sld_playground')
    expect(snapshot.slides.sld_playground?.thumbnailScene.nodes.map((node) => node.id)).toEqual(['shape_demo', 'text_demo', 'table_demo'])
    expect(snapshot.slides.sld_playground_blue?.thumbnailScene.nodes.map((node) => node.id)).toEqual(['table_demo'])
    expect(structuredClone(snapshot)).toEqual(snapshot)
  })

  it('switches pages without creating history or moving selection', () => {
    const host = createPlaygroundPresentationHost()
    host.selectElement('text_demo')

    const switched = host.selectSlide('sld_playground_blue')

    expect(switched.activeSlideId).toBe('sld_playground_blue')
    expect(switched.slides.sld_playground?.engineState.selection).toEqual(['text_demo'])
    expect(switched.slides.sld_playground_blue?.engineState.selection).toEqual([])
    expect(switched.slides.sld_playground_blue?.engineState.history).toEqual({ undoDepth: 0, redoDepth: 0 })
  })

  it('preserves active page when selecting an unknown page', () => {
    const host = createPlaygroundPresentationHost()

    const result = host.selectSlide('sld_missing')

    expect(result.activeSlideId).toBe('sld_playground')
    expect(result.status).toEqual({ kind: 'error', message: 'slide-missing' })
  })

  it('keeps edits, selection, and history isolated when returning to a page', () => {
    const host = createPlaygroundPresentationHost()
    host.selectElement('text_demo')
    host.moveSelected('text_demo', 914400, 0)
    host.selectSlide('sld_playground_blue')
    host.selectElement('table_demo')
    host.moveSelected('table_demo', 914400, 0)

    const result = host.selectSlide('sld_playground')

    expect(result.slides.sld_playground?.engineState.selection).toEqual(['text_demo'])
    expect(result.slides.sld_playground?.engineState.document.elements.text_demo?.bounds.x).toBe(1828800)
    expect(result.slides.sld_playground?.engineState.history).toEqual({ undoDepth: 1, redoDepth: 0 })
    expect(result.slides.sld_playground_blue?.engineState.selection).toEqual(['table_demo'])
    expect(result.slides.sld_playground_blue?.engineState.document.elements.table_demo?.bounds.x).toBe(1828800)
    expect(result.slides.sld_playground_blue?.engineState.history).toEqual({ undoDepth: 1, redoDepth: 0 })
  })
})

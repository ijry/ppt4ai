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

  it('adds a blank page after the active page and activates it', () => {
    const host = createPlaygroundPresentationHost()

    const result = host.addSlide()
    const addedSlideId = result.activeSlideId

    expect(result.slideOrder).toEqual(['sld_playground', addedSlideId, 'sld_playground_blue'])
    expect(addedSlideId).not.toBe('sld_playground')
    expect(addedSlideId).not.toBe('sld_playground_blue')
    expect(result.slides[addedSlideId]?.title).toBe('Page 2')
    expect(result.slides[addedSlideId]?.engineState.document.slides[addedSlideId]?.elementIds).toEqual([])
    expect(result.slides[addedSlideId]?.engineState.history).toEqual({ undoDepth: 0, redoDepth: 0 })
    expect(result.status).toEqual({ kind: 'success', message: 'slide-added' })
  })

  it('duplicates the active page with an independent document and activates the copy', () => {
    const host = createPlaygroundPresentationHost()
    host.selectElement('text_demo')
    host.moveSelected('text_demo', 914400, 0)

    const result = host.duplicateSlide()
    const copiedSlideId = result.activeSlideId

    expect(result.slideOrder).toEqual(['sld_playground', copiedSlideId, 'sld_playground_blue'])
    expect(result.slides[copiedSlideId]?.title).toBe('Page 1 copy')
    expect(result.slides[copiedSlideId]?.engineState.document.id).not.toBe(result.slides.sld_playground?.engineState.document.id)
    expect(result.slides[copiedSlideId]?.engineState.document.slides[copiedSlideId]?.elementIds).toEqual(['group_demo', 'table_demo'])
    expect(result.slides[copiedSlideId]?.engineState.document.elements.text_demo?.bounds.x).toBe(1828800)
    expect(result.slides[copiedSlideId]?.engineState.history).toEqual({ undoDepth: 0, redoDepth: 0 })
    expect(result.status).toEqual({ kind: 'success', message: 'slide-duplicated' })

    host.moveSelected('text_demo', 914400, 0)
    expect(host.getSnapshot().slides.sld_playground?.engineState.document.elements.text_demo?.bounds.x).toBe(1828800)
    expect(host.getSnapshot().slides[copiedSlideId]?.engineState.document.elements.text_demo?.bounds.x).toBe(2743200)
  })

  it('deletes the active page and activates the next available page', () => {
    const host = createPlaygroundPresentationHost()
    host.selectSlide('sld_playground_blue')

    const result = host.deleteSlide()

    expect(result.slideOrder).toEqual(['sld_playground'])
    expect(result.activeSlideId).toBe('sld_playground')
    expect(result.status).toEqual({ kind: 'success', message: 'slide-deleted' })
  })

  it('keeps one page when deleting the last remaining page', () => {
    const host = createPlaygroundPresentationHost()
    host.deleteSlide()

    const result = host.deleteSlide()

    expect(result.slideOrder).toEqual(['sld_playground_blue'])
    expect(result.activeSlideId).toBe('sld_playground_blue')
    expect(result.status).toEqual({ kind: 'error', message: 'slide-delete-blocked' })
  })

  it('moves a page up or down without changing its document state', () => {
    const host = createPlaygroundPresentationHost()
    host.selectSlide('sld_playground_blue')
    host.selectElement('table_demo')
    host.moveSelected('table_demo', 914400, 0)

    const movedUp = host.moveSlide('sld_playground_blue', 'up')
    expect(movedUp.slideOrder).toEqual(['sld_playground_blue', 'sld_playground'])
    expect(movedUp.activeSlideId).toBe('sld_playground_blue')
    expect(movedUp.slides.sld_playground_blue?.engineState.document.elements.table_demo?.bounds.x).toBe(1828800)
    expect(movedUp.slides.sld_playground_blue?.engineState.selection).toEqual(['table_demo'])
    expect(movedUp.status).toEqual({ kind: 'success', message: 'slide-reordered' })

    const movedDown = host.moveSlide('sld_playground_blue', 'down')
    expect(movedDown.slideOrder).toEqual(['sld_playground', 'sld_playground_blue'])
    expect(movedDown.activeSlideId).toBe('sld_playground_blue')
  })
})

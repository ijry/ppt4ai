import { describe, expect, it } from 'vitest'
import type { PlaygroundPresentationSnapshot } from '../presentation-host'
import { toolbarModel } from './toolbar-model'
import { inspectorContext } from './inspector-context'
import { zoomIn, zoomOut, fitZoom } from './zoom'

function snap(opts: { selection?: string[]; kinds?: Record<string, string>; clipboard?: boolean; undo?: number }): PlaygroundPresentationSnapshot {
  const elements = Object.fromEntries(Object.entries(opts.kinds ?? {}).map(([id, kind]) => [id, { id, kind }]))
  return {
    slideOrder: ['sld_1'], activeSlideId: 'sld_1',
    slides: { sld_1: { id: 'sld_1', title: 'S', thumbnailScene: {} as never,
      engineState: { selection: new Set(opts.selection ?? []), document: { elements },
        history: { undoDepth: opts.undo ?? 0, redoDepth: 0 } } } },
    presentationHistory: { undoDepth: 0, redoDepth: 0 },
    clipboard: { hasContent: opts.clipboard ?? false, rootCount: 0, elementCount: 0 },
    status: 'idle',
  } as unknown as PlaygroundPresentationSnapshot
}

describe('toolbarModel', () => {
  it('reflects selection, clipboard, history, group/ungroup', () => {
    expect(toolbarModel(snap({}))).toMatchObject({ canUndo: false, canCopy: false, canPaste: false, canGroup: false, canUngroup: false })
    expect(toolbarModel(snap({ selection: ['a', 'b'] })).canGroup).toBe(true)
    expect(toolbarModel(snap({ selection: ['g'], kinds: { g: 'group' } })).canUngroup).toBe(true)
    expect(toolbarModel(snap({ clipboard: true })).canPaste).toBe(true)
    expect(toolbarModel(snap({ undo: 1 })).canUndo).toBe(true)
  })
})

describe('inspectorContext', () => {
  it('is object when something is selected, else slide', () => {
    expect(inspectorContext(snap({}))).toBe('slide')
    expect(inspectorContext(snap({ selection: ['a'] }))).toBe('object')
  })
})

describe('zoom', () => {
  it('steps and fits', () => {
    expect(zoomIn(1)).toBeGreaterThan(1)
    expect(zoomOut(1)).toBeLessThan(1)
    expect(fitZoom({ w: 960, h: 540 }, { w: 9600, h: 5400 })).toBeCloseTo(0.1)
  })
})

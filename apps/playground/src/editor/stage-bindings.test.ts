import { describe, expect, it } from 'vitest'
import type { PlaygroundPresentationSnapshot } from '../presentation-host'
import { stageBindings } from './stage-bindings'

function snap(sel: string[], elements: Record<string, unknown>, scene: unknown): PlaygroundPresentationSnapshot {
  return { slideOrder: ['s'], activeSlideId: 's',
    slides: { s: { id: 's', title: 's', thumbnailScene: scene, engineState: { selection: new Set(sel), document: { elements }, history: { undoDepth: 0, redoDepth: 0 } } } },
    presentationHistory: { undoDepth: 0, redoDepth: 0 }, clipboard: { hasContent: false, rootCount: 0, elementCount: 0 }, status: 'idle' } as unknown as PlaygroundPresentationSnapshot
}

describe('stageBindings', () => {
  it('exposes the active scene, single/multi selection, and text bodies', () => {
    const scene = { slideId: 's', page: { w: 9600, h: 5400 }, nodes: [] }
    const b = stageBindings(snap(['t1'], { t1: { id: 't1', kind: 'text', text: 'hi' } }, scene))
    expect(b.scene).toBe(scene)
    expect(b.selectedElementId).toBe('t1')
    expect(b.selectedElementIds).toEqual(['t1'])
    expect(b.textBodies.t1).toBeTruthy()
    expect(stageBindings(snap(['a', 'b'], {}, scene)).selectedElementId).toBeUndefined()
  })
})

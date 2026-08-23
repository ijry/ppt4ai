import type { SceneGraph } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { hitTestScene, pointFromCanvasEvent } from './slide-canvas'

function scene(): SceneGraph {
  return {
    slideId: 'slide-1',
    page: { w: 9144000, h: 5143500 },
    nodes: [
      { id: 'bottom', kind: 'shape', bounds: { x: 100, y: 100, w: 500, h: 500 }, path: [] },
      { id: 'top', kind: 'text', bounds: { x: 250, y: 250, w: 500, h: 500 }, text: '', layout: { bounds: { x: 250, y: 250, w: 500, h: 500 }, fontScale: 100000, overflow: false, contentBounds: { x: 250, y: 250, w: 500, h: 500 }, lines: [] } },
    ],
  }
}

describe('slide canvas hit testing', () => {
  it('selects the topmost node and includes bounds edges', () => {
    expect(hitTestScene(scene(), { x: 300, y: 300 })).toBe('top')
    expect(hitTestScene(scene(), { x: 100, y: 100 })).toBe('bottom')
    expect(hitTestScene(scene(), { x: 900, y: 900 })).toBeUndefined()
  })

  it('converts client coordinates to EMU using the canvas rect and zoom', () => {
    const canvas = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 960, height: 540 }) } as HTMLCanvasElement
    expect(pointFromCanvasEvent({ clientX: 106, clientY: 101 } as PointerEvent, canvas, 2)).toEqual({ x: 457200, y: 385762.5 })
  })
})

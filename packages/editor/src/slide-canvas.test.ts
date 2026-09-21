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

  it('selects the top-level group instead of penetrating grouped leaves', () => {
    const groupedScene: SceneGraph = {
      ...scene(),
      nodes: [
        ...scene().nodes,
        { id: 'group-leaf', kind: 'shape', bounds: { x: 120, y: 120, w: 80, h: 80 }, path: [] },
      ],
      groups: [
        {
          id: 'group-outer',
          bounds: { x: 100, y: 100, w: 500, h: 500 },
          childIds: ['group-leaf'],
          ancestorIds: [],
          paintOrder: 2,
        },
      ],
    }

    expect(hitTestScene(groupedScene, { x: 130, y: 130 })).toBe('group-outer')
    expect(hitTestScene(groupedScene, { x: 550, y: 550 })).toBe('group-outer')
    expect(hitTestScene(groupedScene, { x: 750, y: 300 })).toBe('top')
  })

  it('keeps a later ungrouped node above an earlier overlapping group', () => {
    const groupedScene: SceneGraph = {
      slideId: 'slide-1',
      page: { w: 9144000, h: 5143500 },
      nodes: [
        { id: 'group-leaf', kind: 'shape', bounds: { x: 100, y: 100, w: 500, h: 500 }, path: [] },
        { id: 'later-node', kind: 'shape', bounds: { x: 200, y: 200, w: 200, h: 200 }, path: [] },
      ],
      groups: [
        {
          id: 'group-outer',
          bounds: { x: 100, y: 100, w: 500, h: 500 },
          childIds: ['group-leaf'],
          ancestorIds: [],
          paintOrder: 0,
        },
      ],
    }

    expect(hitTestScene(groupedScene, { x: 250, y: 250 })).toBe('later-node')
  })

  it('selects direct children when a group path is active', () => {
    const groupedScene: SceneGraph = {
      slideId: 'slide-1',
      page: { w: 9144000, h: 5143500 },
      nodes: [
        { id: 'outer-leaf', kind: 'shape', bounds: { x: 100, y: 100, w: 100, h: 100 }, path: [] },
        { id: 'inner-leaf', kind: 'shape', bounds: { x: 300, y: 100, w: 100, h: 100 }, path: [] },
      ],
      groups: [
        { id: 'outer', bounds: { x: 50, y: 50, w: 500, h: 300 }, childIds: ['outer-leaf', 'inner'], ancestorIds: [], paintOrder: 1 },
        { id: 'inner', bounds: { x: 250, y: 50, w: 250, h: 250 }, childIds: ['inner-leaf'], ancestorIds: ['outer'], paintOrder: 1 },
      ],
    }

    expect(hitTestScene(groupedScene, { x: 120, y: 120 }, ['outer'])).toBe('outer-leaf')
    expect(hitTestScene(groupedScene, { x: 320, y: 120 }, ['outer'])).toBe('inner')
    expect(hitTestScene(groupedScene, { x: 320, y: 120 }, ['outer', 'inner'])).toBe('inner-leaf')
  })

  it('falls back to top-level hit testing outside the active group bounds', () => {
    const groupedScene: SceneGraph = {
      ...scene(),
      groups: [
        { id: 'outer', bounds: { x: 50, y: 50, w: 150, h: 150 }, childIds: [], ancestorIds: [], paintOrder: 1 },
      ],
    }

    expect(hitTestScene(groupedScene, { x: 300, y: 300 }, ['outer'])).toBe('top')
  })
})

import type { SceneGraph } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { snapResizeBounds } from './resize-snapping'

const scene: SceneGraph = {
  slideId: 'slide-1',
  page: { w: 2000, h: 1200 },
  nodes: [
    { id: 'selected', kind: 'shape', bounds: { x: 100, y: 100, w: 100, h: 100 }, path: [] },
    { id: 'peer-first', kind: 'shape', bounds: { x: 300, y: 100, w: 100, h: 100 }, path: [] },
    { id: 'peer-second', kind: 'shape', bounds: { x: 300, y: 300, w: 100, h: 100 }, path: [] },
    { id: 'group-leaf', kind: 'shape', bounds: { x: 650, y: 100, w: 100, h: 100 }, path: [] },
    { id: 'nested-leaf', kind: 'shape', bounds: { x: 700, y: 200, w: 100, h: 100 }, path: [] },
    { id: 'outside', kind: 'shape', bounds: { x: 1000, y: 100, w: 100, h: 100 }, path: [] },
  ],
  groups: [
    { id: 'group-1', bounds: { x: 600, y: 50, w: 400, h: 350 }, childIds: ['group-2', 'group-leaf'], ancestorIds: [], paintOrder: 5 },
    { id: 'group-2', bounds: { x: 680, y: 180, w: 180, h: 180 }, childIds: ['nested-leaf'], ancestorIds: ['group-1'], paintOrder: 4 },
  ],
}

describe('resize snapping', () => {
  it('snaps an east edge to an unselected object edge', () => {
    const result = snapResizeBounds({
      scene,
      selectedElementIds: ['selected'],
      sourceBounds: { x: 100, y: 100, w: 100, h: 100 },
      proposedBounds: { x: 100, y: 100, w: 195, h: 100 },
      handle: 'e',
      options: { enabled: true, threshold: 10 },
    })

    expect(result).toEqual({
      bounds: { x: 100, y: 100, w: 200, h: 100 },
      guides: [{ axis: 'x', position: 300, source: 'element', elementId: 'peer-first' }],
    })
  })

  it('leaves an edge unchanged when every candidate is outside threshold', () => {
    const result = snapResizeBounds({
      scene,
      selectedElementIds: ['selected', 'peer-first', 'peer-second', 'group-1', 'outside'],
      sourceBounds: { x: 100, y: 100, w: 100, h: 100 },
      proposedBounds: { x: 100, y: 100, w: 180, h: 100 },
      handle: 'e',
      options: { enabled: true, threshold: 10 },
    })

    expect(result.bounds).toEqual({ x: 100, y: 100, w: 180, h: 100 })
    expect(result.guides).toEqual([])
  })

  it('uses the nearest configured grid line when no object candidate is closer', () => {
    const result = snapResizeBounds({
      scene: { ...scene, nodes: [scene.nodes[0]!] },
      selectedElementIds: ['selected'],
      sourceBounds: { x: 100, y: 100, w: 100, h: 100 },
      proposedBounds: { x: 100, y: 100, w: 194, h: 100 },
      handle: 'e',
      options: { enabled: true, gridSize: 100, threshold: 10 },
    })

    expect(result).toEqual({
      bounds: { x: 100, y: 100, w: 200, h: 100 },
      guides: [{ axis: 'x', position: 300, source: 'grid' }],
    })
  })

  it('excludes selected group descendants and keeps unselected group as one candidate', () => {
    const result = snapResizeBounds({
      scene,
      selectedElementIds: ['group-1'],
      sourceBounds: { x: 600, y: 50, w: 400, h: 350 },
      proposedBounds: { x: 600, y: 50, w: 45, h: 350 },
      handle: 'w',
      options: { enabled: true, threshold: 10 },
    })

    expect(result.guides).toEqual([])
  })

  it('uses scene order and element-before-grid tie breaking', () => {
    const result = snapResizeBounds({
      scene,
      selectedElementIds: ['selected'],
      sourceBounds: { x: 100, y: 100, w: 100, h: 100 },
      proposedBounds: { x: 100, y: 100, w: 195, h: 100 },
      handle: 'e',
      options: { enabled: true, gridSize: 300, threshold: 10 },
    })

    expect(result.guides).toEqual([
      { axis: 'x', position: 300, source: 'element', elementId: 'peer-first' },
    ])
  })

  it('keeps the source aspect ratio while using one guide for a locked corner', () => {
    const result = snapResizeBounds({
      scene: {
        ...scene,
        nodes: [
          scene.nodes[0]!,
          { id: 'aspect-peer', kind: 'shape', bounds: { x: 260, y: 600, w: 100, h: 100 }, path: [] },
        ],
      },
      selectedElementIds: ['selected'],
      sourceBounds: { x: 100, y: 100, w: 100, h: 60 },
      proposedBounds: { x: 100, y: 100, w: 150, h: 80 },
      handle: 'se',
      aspectRatioLocked: true,
      options: { enabled: true, threshold: 15 },
    })

    expect(result.bounds.w / result.bounds.h).toBeCloseTo(100 / 60)
    expect(result.guides).toEqual([
      { axis: 'x', position: 260, source: 'element', elementId: 'aspect-peer' },
    ])
  })

  it('returns fresh unchanged data when snapping is disabled', () => {
    const request = {
      scene,
      selectedElementIds: ['selected'],
      sourceBounds: { x: 100, y: 100, w: 100, h: 100 },
      proposedBounds: { x: 100, y: 100, w: 195, h: 100 },
      handle: 'e' as const,
      options: { enabled: false, threshold: 10 },
    }
    const result = snapResizeBounds(request)
    expect(result).toEqual({ bounds: request.proposedBounds, guides: [] })
    expect(result.bounds).not.toBe(request.proposedBounds)
    expect(structuredClone(result)).toEqual(result)
  })

  it('does not apply an aspect snap that would make the moving edge cross its opposite edge', () => {
    const result = snapResizeBounds({
      scene: {
        ...scene,
        nodes: [
          scene.nodes[0]!,
          { id: 'crossing-peer', kind: 'shape', bounds: { x: 0, y: 600, w: 100, h: 100 }, path: [] },
        ],
      },
      selectedElementIds: ['selected'],
      sourceBounds: { x: 100, y: 100, w: 100, h: 60 },
      proposedBounds: { x: 100, y: 100, w: 5, h: 3 },
      handle: 'se',
      aspectRatioLocked: true,
      options: { enabled: true, threshold: 200 },
    })

    expect(result).toEqual({
      bounds: { x: 100, y: 100, w: 5, h: 3 },
      guides: [],
    })
  })
})

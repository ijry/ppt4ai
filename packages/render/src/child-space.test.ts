import { describe, expect, it } from 'vitest'
import type { Ppt4aiDocument } from '@ppt4ai/model'
import { documentToSceneGraph } from './scenegraph'

/** Outer group is scaled 2:1 relative to the space its children are authored in. */
function scaledGroupDocument(childSpace?: { x: number; y: number; w: number; h: number }): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_child_space',
    page: { w: 10000000, h: 6000000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['grp_1', 'el_1'] } },
    elements: {
      grp_1: {
        id: 'grp_1',
        kind: 'group',
        bounds: { x: 1000000, y: 2000000, w: 2000000, h: 1000000 },
        childIds: ['el_1'],
        ...(childSpace ? { childSpace } : {}),
      },
      el_1: { id: 'el_1', kind: 'shape', preset: 'rect', bounds: { x: 5000000, y: 6000000, w: 4000000, h: 2000000 } },
    },
    slideOrder: ['sld_1'],
  }
}

const childSpace = { x: 5000000, y: 6000000, w: 4000000, h: 2000000 }

function leaf(document: Ppt4aiDocument) {
  const node = documentToSceneGraph(document).nodes.find((entry) => entry.id === 'el_1')
  if (!node) throw new Error('leaf missing from scene')
  return node
}

describe('child space mapping in the scene graph', () => {
  it('maps a child filling the child space onto the full group extent', () => {
    expect(leaf(scaledGroupDocument(childSpace)).bounds).toEqual({ x: 1000000, y: 2000000, w: 2000000, h: 1000000 })
  })

  it('leaves child bounds untouched when the group declares no child space', () => {
    expect(leaf(scaledGroupDocument()).bounds).toEqual({ x: 5000000, y: 6000000, w: 4000000, h: 2000000 })
  })

  it('halves a child that occupies half the child space', () => {
    const document = scaledGroupDocument(childSpace)
    document.elements.el_1!.bounds = { x: 5000000, y: 6000000, w: 2000000, h: 1000000 }

    expect(leaf(document).bounds).toEqual({ x: 1000000, y: 2000000, w: 1000000, h: 500000 })
  })

  it('re-anchors a child offset from the child space origin', () => {
    const document = scaledGroupDocument(childSpace)
    document.elements.el_1!.bounds = { x: 7000000, y: 7000000, w: 2000000, h: 1000000 }

    expect(leaf(document).bounds).toEqual({ x: 2000000, y: 2500000, w: 1000000, h: 500000 })
  })

  it('is the identity when the child space equals the group bounds', () => {
    const document = scaledGroupDocument({ x: 1000000, y: 2000000, w: 2000000, h: 1000000 })
    document.elements.el_1!.bounds = { x: 1500000, y: 2250000, w: 500000, h: 250000 }

    expect(leaf(document).bounds).toEqual({ x: 1500000, y: 2250000, w: 500000, h: 250000 })
  })

  it('keeps text layout aligned with the mapped bounds', () => {
    const document = scaledGroupDocument(childSpace)
    document.elements.el_1 = { id: 'el_1', kind: 'text', bounds: { x: 5000000, y: 6000000, w: 4000000, h: 2000000 }, text: 'Inside' }

    const node = leaf(document)
    if (node.kind !== 'text') throw new Error('expected a text node')

    expect(node.layout.bounds).toEqual(node.bounds)
  })

  it('composes nested child spaces so each level halves the child again', () => {
    const document: Ppt4aiDocument = {
      format: 'ppt4ai',
      version: 1,
      id: 'dck_nested_space',
      page: { w: 10000000, h: 6000000 },
      slides: { sld_1: { id: 'sld_1', elementIds: ['grp_1', 'grp_2', 'el_1'] } },
      elements: {
        grp_1: {
          id: 'grp_1',
          kind: 'group',
          bounds: { x: 0, y: 0, w: 1000000, h: 1000000 },
          childIds: ['grp_2'],
          childSpace: { x: 0, y: 0, w: 2000000, h: 2000000 },
        },
        grp_2: {
          id: 'grp_2',
          kind: 'group',
          bounds: { x: 0, y: 0, w: 1000000, h: 1000000 },
          childIds: ['el_1'],
          childSpace: { x: 0, y: 0, w: 2000000, h: 2000000 },
        },
        el_1: { id: 'el_1', kind: 'shape', preset: 'rect', bounds: { x: 0, y: 0, w: 2000000, h: 2000000 } },
      },
      slideOrder: ['sld_1'],
    }

    const scene = documentToSceneGraph(document)
    const inner = scene.groups?.find((group) => group.id === 'grp_2')

    // Inner group is 1000000 wide in the outer 2:1 space, so 500000 on the slide.
    expect(inner?.bounds).toEqual({ x: 0, y: 0, w: 500000, h: 500000 })
    // Leaf fills the inner space: halved by the inner mapping, then by the outer.
    expect(leaf(document).bounds).toEqual({ x: 0, y: 0, w: 500000, h: 500000 })
  })

  it('applies the child space before rotation so the pivot is the on-slide centre', () => {
    const document = scaledGroupDocument(childSpace)
    const group = document.elements.grp_1
    if (group?.kind !== 'group') throw new Error('expected a group')
    group.rotation = 10800000

    const node = leaf(document)

    // A half turn about the group centre maps the fully-covering child onto itself.
    expect(node.bounds.x).toBeCloseTo(1000000, 6)
    expect(node.bounds.y).toBeCloseTo(2000000, 6)
    expect(node.transform?.rotation).toBe(10800000)
  })
})

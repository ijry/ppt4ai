import { describe, expect, it } from 'vitest'
import { documentToSceneGraph } from '@ppt4ai/render'
import type { Ppt4aiDocument } from '@ppt4ai/model'
import { EditorEngine } from './index'

/**
 * A child centred in its group sits on the group's mirror axis, so flipping either one leaves the
 * child's box where it is. That makes the pair a clean probe for what a flip means.
 */
function centredInGroupDocument(leafRotation?: number): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_probe',
    page: { w: 20000000, h: 12000000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['grp_1', 'el_a'] } },
    elements: {
      grp_1: { id: 'grp_1', kind: 'group', bounds: { x: 1000000, y: 1000000, w: 4000000, h: 2000000 }, childIds: ['el_a'] },
      el_a: {
        id: 'el_a',
        kind: 'shape',
        preset: 'triangle',
        // Centred on the group centre (3000000, 2000000), so a mirror leaves the box in place.
        bounds: { x: 2500000, y: 1750000, w: 1000000, h: 500000 },
        ...(leafRotation === undefined ? {} : { rotation: leafRotation }),
      },
    },
    slideOrder: ['sld_1'],
  }
}

function leafNode(document: Ppt4aiDocument) {
  const node = documentToSceneGraph(document).nodes.find((entry) => entry.id === 'el_a')
  if (!node) throw new Error('leaf node missing from scene')
  return node
}

function flip(document: Ppt4aiDocument, elementId: string) {
  return new EditorEngine(document).dispatch({ type: 'toggleElementFlip', elementId, axis: 'horizontal' }).document
}

describe('what a flip mirrors about', () => {
  it('agrees for an unrotated child, whichever of the two is flipped', () => {
    expect(leafNode(flip(centredInGroupDocument(), 'el_a'))).toEqual(leafNode(flip(centredInGroupDocument(), 'grp_1')))
  })

  /**
   * Not a bug, and the reason the two commands stay separate. A group mirrors about a screen-aligned
   * axis, which reverses the sense of a descendant's angle. Flipping the shape itself mirrors inside
   * its own already-rotated box, which does not. Once the child carries an angle those axes are no
   * longer parallel, so the results are supposed to diverge.
   */
  it('diverges once the child is rotated, because the two mirror axes are no longer parallel', () => {
    const viaLeaf = leafNode(flip(centredInGroupDocument(1800000), 'el_a'))
    const viaGroup = leafNode(flip(centredInGroupDocument(1800000), 'grp_1'))

    expect(viaLeaf.transform).toEqual({ rotation: 1800000, flipH: true })
    expect(viaGroup.transform).toEqual({ rotation: -1800000, flipH: true })
    expect(viaLeaf.bounds).toEqual(viaGroup.bounds)
  })
})

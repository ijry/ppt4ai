import { describe, expect, it } from 'vitest'
import type { Ppt4aiDocument } from '@ppt4ai/model'
import { documentToSceneGraph } from './scenegraph'

function flippedDocument(flips: { flipH?: boolean; flipV?: boolean }, rotation?: number): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_flip',
    page: { w: 10000000, h: 6000000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['shape_1', 'text_1', 'table_1'] } },
    elements: {
      shape_1: { id: 'shape_1', kind: 'shape', preset: 'rect', bounds: { x: 0, y: 0, w: 1000, h: 500 }, ...flips, ...(rotation === undefined ? {} : { rotation }) },
      text_1: { id: 'text_1', kind: 'text', bounds: { x: 2000, y: 0, w: 1000, h: 500 }, text: 'Mirrored', ...flips },
      table_1: {
        id: 'table_1',
        kind: 'table',
        bounds: { x: 4000, y: 0, w: 1000, h: 500 },
        columns: [1000],
        rows: [{ height: 500, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'Cell' }] }] } }] }],
        ...flips,
      },
    },
    slideOrder: ['sld_1'],
  }
}

function node(document: Ppt4aiDocument, id: string) {
  const found = documentToSceneGraph(document).nodes.find((entry) => entry.id === id)
  if (!found) throw new Error(`node ${id} missing`)
  return found
}

describe('flip in the scene graph', () => {
  it('carries flipH onto shape, text and table nodes', () => {
    const document = flippedDocument({ flipH: true })

    expect(node(document, 'shape_1').transform).toEqual({ flipH: true })
    expect(node(document, 'text_1').transform).toEqual({ flipH: true })
    expect(node(document, 'table_1').transform).toEqual({ flipH: true })
  })

  it('carries both axes', () => {
    expect(node(flippedDocument({ flipH: true, flipV: true }), 'shape_1').transform).toEqual({ flipH: true, flipV: true })
  })

  it('keeps rotation and flip in one transform', () => {
    expect(node(flippedDocument({ flipV: true }, 2700000), 'shape_1').transform).toEqual({ rotation: 2700000, flipV: true })
  })

  it('omits the transform entirely when nothing is set', () => {
    expect(node(flippedDocument({}), 'shape_1')).not.toHaveProperty('transform')
  })

  it('cascades a group flip onto its descendants', () => {
    const document = flippedDocument({})
    document.elements.grp_1 = {
      id: 'grp_1',
      kind: 'group',
      bounds: { x: 0, y: 0, w: 1000, h: 500 },
      childIds: ['shape_1'],
      flipH: true,
    }
    document.slides.sld_1!.elementIds = ['grp_1', 'shape_1', 'text_1', 'table_1']

    expect(node(document, 'shape_1').transform).toMatchObject({ flipH: true })
  })

  it('cancels a descendant flip against an equal group flip', () => {
    const document = flippedDocument({ flipH: true })
    document.elements.grp_1 = {
      id: 'grp_1',
      kind: 'group',
      bounds: { x: 0, y: 0, w: 1000, h: 500 },
      childIds: ['shape_1'],
      flipH: true,
    }
    document.slides.sld_1!.elementIds = ['grp_1', 'shape_1', 'text_1', 'table_1']

    // Two mirrorings about parallel axes compose to the identity.
    expect(node(document, 'shape_1')).not.toHaveProperty('transform')
  })

  it('reports the group flip on the scene group', () => {
    const document = flippedDocument({})
    document.elements.grp_1 = {
      id: 'grp_1',
      kind: 'group',
      bounds: { x: 0, y: 0, w: 1000, h: 500 },
      childIds: ['shape_1'],
      flipV: true,
    }
    document.slides.sld_1!.elementIds = ['grp_1', 'shape_1', 'text_1', 'table_1']

    const group = documentToSceneGraph(document).groups?.find((entry) => entry.id === 'grp_1')
    expect(group?.flipV).toBe(true)
  })
})

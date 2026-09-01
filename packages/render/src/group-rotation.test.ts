import { describe, expect, it } from 'vitest'
import { boundsCentre, rotatePointAround } from '@ppt4ai/geometry'
import type { Ppt4aiDocument } from '@ppt4ai/model'
import { documentToSceneGraph } from './scenegraph'

const quarterTurn = 5400000
const halfTurn = 10800000

const childBounds = { x: 400, y: 500, w: 200, h: 100 }
const innerBounds = { x: 300, y: 400, w: 400, h: 300 }
const outerBounds = { x: 0, y: 100, w: 1000, h: 1000 }

function groupedDocument(outerRotation?: number, innerRotation?: number, leafRotation?: number): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_group_rotation',
    page: { w: 10000000, h: 6000000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['grp_outer'] } },
    elements: {
      leaf: { id: 'leaf', kind: 'shape', preset: 'rect', bounds: { ...childBounds }, ...(leafRotation === undefined ? {} : { rotation: leafRotation }) },
      grp_inner: { id: 'grp_inner', kind: 'group', bounds: { ...innerBounds }, childIds: ['leaf'], ...(innerRotation === undefined ? {} : { rotation: innerRotation }) },
      grp_outer: { id: 'grp_outer', kind: 'group', bounds: { ...outerBounds }, childIds: ['grp_inner'], ...(outerRotation === undefined ? {} : { rotation: outerRotation }) },
    },
    slideOrder: ['sld_1'],
  }
}

function leafNode(document: Ppt4aiDocument) {
  const node = documentToSceneGraph(document).nodes.find((entry) => entry.id === 'leaf')
  if (!node) throw new Error('leaf node missing from scene')
  return node
}

function sceneGroup(document: Ppt4aiDocument, id: string) {
  const group = documentToSceneGraph(document).groups?.find((entry) => entry.id === id)
  if (!group) throw new Error(`group ${id} missing from scene`)
  return group
}

describe('group rotation cascade', () => {
  it('leaves descendants untouched when no group rotates', () => {
    const node = leafNode(groupedDocument())

    expect(node.bounds).toEqual(childBounds)
    expect(node).not.toHaveProperty('transform')
  })

  it('applies an ancestor rotation to a descendant centre and angle', () => {
    const node = leafNode(groupedDocument(quarterTurn))
    const expected = rotatePointAround(boundsCentre(childBounds), boundsCentre(outerBounds), quarterTurn)

    expect(node.transform).toEqual({ rotation: quarterTurn })
    expect(boundsCentre(node.bounds).x).toBeCloseTo(expected.x, 6)
    expect(boundsCentre(node.bounds).y).toBeCloseTo(expected.y, 6)
    expect(node.bounds.w).toBe(childBounds.w)
    expect(node.bounds.h).toBe(childBounds.h)
  })

  it('sums the descendant rotation with its ancestor rotation', () => {
    const node = leafNode(groupedDocument(quarterTurn, undefined, 900000))

    expect(node.transform).toEqual({ rotation: quarterTurn + 900000 })
  })

  it('folds nested groups innermost first', () => {
    const node = leafNode(groupedDocument(quarterTurn, halfTurn))
    const afterInner = rotatePointAround(boundsCentre(childBounds), boundsCentre(innerBounds), halfTurn)
    const afterOuter = rotatePointAround(afterInner, boundsCentre(outerBounds), quarterTurn)

    expect(node.transform).toEqual({ rotation: quarterTurn + halfTurn })
    expect(boundsCentre(node.bounds).x).toBeCloseTo(afterOuter.x, 6)
    expect(boundsCentre(node.bounds).y).toBeCloseTo(afterOuter.y, 6)
  })

  it('reports the effective rotation on scene groups', () => {
    const document = groupedDocument(quarterTurn, halfTurn)

    expect(sceneGroup(document, 'grp_outer').rotation).toBe(quarterTurn)
    expect(sceneGroup(document, 'grp_inner').rotation).toBe(quarterTurn + halfTurn)
  })

  it('moves a nested group bounds centre by its ancestor rotation', () => {
    const group = sceneGroup(groupedDocument(quarterTurn), 'grp_inner')
    const expected = rotatePointAround(boundsCentre(innerBounds), boundsCentre(outerBounds), quarterTurn)

    expect(boundsCentre(group.bounds).x).toBeCloseTo(expected.x, 6)
    expect(boundsCentre(group.bounds).y).toBeCloseTo(expected.y, 6)
  })

  it('omits rotation on scene groups when nothing rotates', () => {
    const group = sceneGroup(groupedDocument(), 'grp_outer')

    expect(group.rotation).toBeUndefined()
    expect(group.bounds).toEqual(outerBounds)
  })

  it('cancels out when a nested group undoes its parent rotation', () => {
    const node = leafNode(groupedDocument(quarterTurn, -quarterTurn))

    expect(node).not.toHaveProperty('transform')
  })

  it('keeps text layout aligned with the cascaded bounds', () => {
    const document = groupedDocument(quarterTurn)
    document.elements.leaf = { id: 'leaf', kind: 'text', bounds: { ...childBounds }, text: 'Inside' }

    const node = leafNode(document)
    if (node.kind !== 'text') throw new Error('expected a text node')

    expect(node.layout.bounds).toEqual(node.bounds)
  })

  it('keeps table cell layout aligned with the cascaded bounds', () => {
    const document = groupedDocument(quarterTurn)
    document.elements.leaf = {
      id: 'leaf',
      kind: 'table',
      bounds: { ...childBounds },
      columns: [childBounds.w],
      rows: [{ height: childBounds.h, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'Cell' }] }] } }] }],
    }

    const node = leafNode(document)
    if (node.kind !== 'table') throw new Error('expected a table node')

    expect(node.layout.bounds).toEqual(node.bounds)
    expect(node.layout.cells[0]!.bounds.x).toBeCloseTo(node.bounds.x, 6)
    expect(node.layout.cells[0]!.bounds.y).toBeCloseTo(node.bounds.y, 6)
  })
})

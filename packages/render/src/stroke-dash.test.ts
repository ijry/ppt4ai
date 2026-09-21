import { describe, expect, it } from 'vitest'
import type { Element, Fill, Ppt4aiDocument, StrokeStyle } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

const navy: Fill = { color: { type: 'srgb', v: '203864' } }

function documentWith(element: Element): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_dash',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [element.id] } },
    slideOrder: ['sld_1'],
    elements: { [element.id]: element },
  }
}

function shapeWith(strokeStyle?: StrokeStyle): Element {
  return {
    id: 'el_shape',
    kind: 'shape',
    preset: 'rect',
    bounds: { x: 1000000, y: 1000000, w: 2000000, h: 1000000 },
    stroke: navy,
    strokeWidth: 38100,
    ...(strokeStyle ? { strokeStyle } : {}),
  }
}

function textWith(strokeStyle?: StrokeStyle): Element {
  return {
    id: 'el_text',
    kind: 'text',
    bounds: { x: 1000000, y: 1000000, w: 2000000, h: 1000000 },
    body: { paragraphs: [{ runs: [{ text: 'Label' }] }] },
    stroke: navy,
    strokeWidth: 38100,
    ...(strokeStyle ? { strokeStyle } : {}),
  }
}

function firstNode(element: Element) {
  const node = documentToSceneGraph(documentWith(element)).nodes[0]
  if (!node) throw new Error('fixture did not build a node')
  return node
}

describe('stroke dash on the scene graph', () => {
  it('carries the dash style onto a shape node', () => {
    expect(firstNode(shapeWith('dash'))).toMatchObject({ kind: 'shape', strokeStyle: 'dash' })
    expect(firstNode(shapeWith('dot'))).toMatchObject({ kind: 'shape', strokeStyle: 'dot' })
  })

  it('carries the dash style onto a text node', () => {
    expect(firstNode(textWith('dot'))).toMatchObject({ kind: 'text', strokeStyle: 'dot' })
  })

  /** The field stays absent for a solid outline, matching what import produces. */
  it('omits the dash style when the element carries none', () => {
    expect(firstNode(shapeWith())).not.toHaveProperty('strokeStyle')
    expect(firstNode(textWith())).not.toHaveProperty('strokeStyle')
  })

  it('keeps the scene structured-clone safe', () => {
    const graph = documentToSceneGraph(documentWith(shapeWith('dash')))

    expect(structuredClone(graph)).toEqual(graph)
  })
})

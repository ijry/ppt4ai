import { describe, expect, it } from 'vitest'
import type { Fill, Ppt4aiDocument, PresetGeometry } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

const blue: Fill = { color: { type: 'srgb', v: '4472C4' } }

function documentWith(element: Partial<{ preset: PresetGeometry; fill: Fill; stroke: Fill }>): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_geometry',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_text'] } },
    slideOrder: ['sld_1'],
    elements: {
      el_text: {
        id: 'el_text',
        kind: 'text',
        bounds: { x: 1000000, y: 1000000, w: 2000000, h: 1000000 },
        body: { paragraphs: [{ runs: [{ text: 'Label' }] }] },
        ...element,
      },
    },
  }
}

function textNode(document: Ppt4aiDocument) {
  const node = documentToSceneGraph(document).nodes[0]
  if (node?.kind !== 'text') throw new Error('fixture did not build a text node')
  return node
}

describe('geometry on text scene nodes', () => {
  it('builds the preset path when the element is filled', () => {
    const node = textNode(documentWith({ preset: 'roundRect', fill: blue }))

    expect(node.path?.length).toBeGreaterThan(0)
    expect(node.resolvedFillColor).toEqual({ rgb: '4472C4', alpha: 100000 })
  })

  it('builds a path for a stroke-only element', () => {
    expect(textNode(documentWith({ preset: 'ellipse', stroke: blue })).path?.length).toBeGreaterThan(0)
  })

  /** Plain text keeps the scene shape it had before: no geometry to paint, so none is built. */
  it('omits the path when the element has neither fill nor stroke', () => {
    const node = textNode(documentWith({ preset: 'roundRect' }))

    expect(node).not.toHaveProperty('path')
  })

  /** A filled text box whose source declared no geometry is a rectangle, the same as in PowerPoint. */
  it('defaults to a rectangle when the element has no preset', () => {
    const node = textNode(documentWith({ fill: blue }))
    const rectangle = textNode(documentWith({ preset: 'rect', fill: blue }))

    expect(node.path).toEqual(rectangle.path)
  })

  it('traces the same geometry a shape element of the same bounds would', () => {
    const shapeDocument = documentWith({ preset: 'ellipse', fill: blue })
    shapeDocument.elements.el_text = {
      id: 'el_text',
      kind: 'shape',
      preset: 'ellipse',
      bounds: { x: 1000000, y: 1000000, w: 2000000, h: 1000000 },
      fill: blue,
    }
    const shape = documentToSceneGraph(shapeDocument).nodes[0]
    if (shape?.kind !== 'shape') throw new Error('fixture did not build a shape node')

    expect(textNode(documentWith({ preset: 'ellipse', fill: blue })).path).toEqual(shape.path)
  })

  it('keeps the scene structured-clone safe', () => {
    const graph = documentToSceneGraph(documentWith({ preset: 'triangle', fill: blue, stroke: blue }))

    expect(structuredClone(graph)).toEqual(graph)
  })
})

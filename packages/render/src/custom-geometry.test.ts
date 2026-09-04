import type { CustomGeometry, Element, Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { documentToSceneGraph } from './index'

function documentWith(element: Element): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_custom_geometry',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [element.id] } },
    slideOrder: ['sld_1'],
    elements: { [element.id]: element },
  }
}

const bounds = { x: 0, y: 0, w: 200, h: 100 }
const triangle: CustomGeometry = {
  paths: [{
    width: 100,
    height: 100,
    commands: [
      { type: 'move', x: 0, y: 100 },
      { type: 'line', x: 50, y: 0 },
      { type: 'line', x: 100, y: 100 },
      { type: 'close' },
    ],
  }],
}

describe('custom geometry in the scene graph', () => {
  it('builds the shape path from the custom geometry rather than the preset', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_shape',
      kind: 'shape',
      preset: 'rect',
      bounds,
      customGeometry: triangle,
      fill: { color: { type: 'srgb', v: '4472C4' } },
    })).nodes[0]

    if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
    expect(node.path).toEqual([
      { type: 'move', x: 0, y: 100 },
      { type: 'line', x: 100, y: 0 },
      { type: 'line', x: 200, y: 100 },
      { type: 'close' },
    ])
  })

  /** A shape with text gets the same path, because that is what its fill and outline are drawn on. */
  it('builds a text element path from the custom geometry', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_text',
      kind: 'text',
      bounds,
      text: 'Labelled',
      customGeometry: triangle,
      fill: { color: { type: 'srgb', v: '4472C4' } },
    })).nodes[0]

    if (node?.kind !== 'text') throw new Error('fixture did not build a text node')
    expect(node.path?.[1]).toEqual({ type: 'line', x: 100, y: 0 })
  })

  it('still uses the preset when there is no custom geometry', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_shape',
      kind: 'shape',
      preset: 'ellipse',
      bounds,
      fill: { color: { type: 'srgb', v: '4472C4' } },
    })).nodes[0]

    if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
    expect(node.path.some((command) => command.type === 'arc')).toBe(true)
  })
})

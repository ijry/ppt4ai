import { describe, expect, it } from 'vitest'
import type { Element, Fill, Ppt4aiDocument, Theme } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

const theme: Theme = {
  id: 'theme-1',
  colors: { accent1: { type: 'srgb', v: '4472C4' }, accent2: { type: 'srgb', v: 'ED7D31' } },
  formatScheme: {
    fillStyles: [
      { color: { type: 'scheme', v: 'phClr' } },
      {
        color: { type: 'scheme', v: 'phClr' },
        gradient: {
          stops: [
            { pos: 0, color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'tint', value: 67000 }] } },
            { pos: 100000, color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'shade', value: 60000 }] } },
          ],
          angle: 5400000,
        },
      },
    ],
  },
}

const bounds = { x: 0, y: 0, w: 200, h: 100 }
const accent1 = { type: 'scheme' as const, v: 'accent1' }

function documentWith(element: Element): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_theme_gradient',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [element.id], layoutId: 'lyt_1' } },
    slideOrder: ['sld_1'],
    elements: { [element.id]: element },
    layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } },
    masters: { mst_1: { id: 'mst_1', themeId: 'theme-1' } },
    themes: { 'theme-1': theme },
  }
}

function shapeNode(overrides: Partial<Extract<Element, { kind: 'shape' }>> = {}) {
  const node = documentToSceneGraph(documentWith({
    id: 'el_shape', kind: 'shape', preset: 'rect', bounds, ...overrides,
  })).nodes[0]
  if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
  return node
}

const directGradient: Fill = {
  color: { type: 'scheme', v: 'accent2' },
  gradient: {
    stops: [
      { pos: 0, color: { type: 'scheme', v: 'accent2' } },
      { pos: 100000, color: { type: 'srgb', v: '000000' } },
    ],
  },
}

describe('theme gradient entries in the scene graph', () => {
  /** The stock Office shape: spPr is empty and the ramp comes entirely from the style matrix. */
  it('resolves a gradient for a shape that only carries a fillRef', () => {
    const node = shapeNode({ styleRef: { fill: { idx: 2, color: accent1 } } })

    expect(node.resolvedFillGradient?.stops).toHaveLength(2)
    expect(node.resolvedFillGradient?.angle).toBe(5400000)
    expect(node.resolvedFillColor).toEqual({ rgb: '4472C4', alpha: 100000 })
  })

  it('prefers a direct gradient over the theme entry', () => {
    const node = shapeNode({ fill: directGradient, styleRef: { fill: { idx: 2, color: accent1 } } })

    expect(node.resolvedFillGradient?.stops[1]?.color).toEqual({ rgb: '000000', alpha: 100000 })
  })

  it('carries no gradient when the reference points at a solid entry', () => {
    const node = shapeNode({ styleRef: { fill: { idx: 1, color: accent1 } } })

    expect(node).not.toHaveProperty('resolvedFillGradient')
    expect(node.resolvedFillColor).toEqual({ rgb: '4472C4', alpha: 100000 })
  })

  it('carries no gradient for index zero or an out-of-range index', () => {
    expect(shapeNode({ styleRef: { fill: { idx: 0, color: accent1 } } })).not.toHaveProperty('resolvedFillGradient')
    expect(shapeNode({ styleRef: { fill: { idx: 9, color: accent1 } } })).not.toHaveProperty('resolvedFillGradient')
  })

  it('resolves the entry for a shape that carries text', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_text',
      kind: 'text',
      preset: 'roundRect',
      bounds,
      body: { paragraphs: [{ runs: [{ text: 'Graded' }] }] },
      styleRef: { fill: { idx: 2, color: accent1 } },
    })).nodes[0]

    if (node?.kind !== 'text') throw new Error('fixture did not build a text node')
    expect(node.resolvedFillGradient?.stops).toHaveLength(2)
    expect(node.path?.length).toBeGreaterThan(0)
  })

  it('keeps the scene structured-clone safe', () => {
    const graph = documentToSceneGraph(documentWith({
      id: 'el_shape', kind: 'shape', preset: 'rect', bounds, styleRef: { fill: { idx: 2, color: accent1 } },
    }))

    expect(structuredClone(graph)).toEqual(graph)
  })
})

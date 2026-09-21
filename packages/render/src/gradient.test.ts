import { describe, expect, it } from 'vitest'
import type { Element, Fill, Ppt4aiDocument, Theme } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

const theme: Theme = {
  id: 'theme-1',
  colors: { accent1: { type: 'srgb', v: '4472C4' }, accent2: { type: 'srgb', v: 'ED7D31' } },
}

function documentWith(fill: Fill): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_gradient',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_shape'], layoutId: 'lyt_1' } },
    slideOrder: ['sld_1'],
    elements: {
      el_shape: { id: 'el_shape', kind: 'shape', preset: 'rect', bounds: { x: 0, y: 0, w: 200, h: 100 }, fill },
    },
    layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } },
    masters: { mst_1: { id: 'mst_1', themeId: 'theme-1' } },
    themes: { 'theme-1': theme },
  }
}

function shapeNode(fill: Fill) {
  const node = documentToSceneGraph(documentWith(fill)).nodes[0]
  if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
  return node
}

const themedGradient: Fill = {
  color: { type: 'scheme', v: 'accent1' },
  gradient: {
    stops: [
      { pos: 0, color: { type: 'scheme', v: 'accent1' } },
      { pos: 100000, color: { type: 'scheme', v: 'accent2', transforms: [{ type: 'alpha', value: 50000 }] } },
    ],
    angle: 5400000,
    scaled: true,
  },
}

describe('gradient fills in the scene graph', () => {
  it('resolves every stop colour through the theme', () => {
    const node = shapeNode(themedGradient)

    expect(node.resolvedFillGradient).toEqual({
      stops: [
        { pos: 0, color: { rgb: '4472C4', alpha: 100000 } },
        { pos: 100000, color: { rgb: 'ED7D31', alpha: 50000 } },
      ],
      angle: 5400000,
      scaled: true,
    })
  })

  /** The flat fallback stays set, so a consumer that reads only the colour still paints something. */
  it('keeps the resolved fill colour alongside the gradient', () => {
    expect(shapeNode(themedGradient).resolvedFillColor).toEqual({ rgb: '4472C4', alpha: 100000 })
  })

  it('carries no gradient for a plain fill', () => {
    expect(shapeNode({ color: { type: 'srgb', v: '112233' } })).not.toHaveProperty('resolvedFillGradient')
  })

  /** One resolvable stop is not a ramp, so the node falls back to painting flat. */
  it('drops the gradient when fewer than two stops resolve', () => {
    const node = shapeNode({
      color: { type: 'srgb', v: '4472C4' },
      gradient: {
        stops: [
          { pos: 0, color: { type: 'srgb', v: '4472C4' } },
          { pos: 100000, color: { type: 'scheme', v: 'missingSlot' } },
        ],
      },
    })

    expect(node).not.toHaveProperty('resolvedFillGradient')
    expect(node.resolvedFillColor).toEqual({ rgb: '4472C4', alpha: 100000 })
  })

  it('omits the angle and flag the model does not carry', () => {
    const node = shapeNode({
      color: { type: 'srgb', v: '000000' },
      gradient: {
        stops: [
          { pos: 0, color: { type: 'srgb', v: '000000' } },
          { pos: 100000, color: { type: 'srgb', v: 'FFFFFF' } },
        ],
      },
    })

    expect(node.resolvedFillGradient).toEqual({
      stops: [
        { pos: 0, color: { rgb: '000000', alpha: 100000 } },
        { pos: 100000, color: { rgb: 'FFFFFF', alpha: 100000 } },
      ],
    })
  })

  it('resolves a gradient on a shape that carries text', () => {
    const document = documentWith(themedGradient)
    document.elements.el_shape = {
      id: 'el_shape',
      kind: 'text',
      bounds: { x: 0, y: 0, w: 200, h: 100 },
      body: { paragraphs: [{ runs: [{ text: 'Graded' }] }] },
      fill: themedGradient,
    } as Element
    const node = documentToSceneGraph(document).nodes[0]

    if (node?.kind !== 'text') throw new Error('fixture did not build a text node')
    expect(node.resolvedFillGradient?.stops).toHaveLength(2)
    expect(node.path?.length).toBeGreaterThan(0)
  })

  it('keeps the scene structured-clone safe', () => {
    const graph = documentToSceneGraph(documentWith(themedGradient))

    expect(structuredClone(graph)).toEqual(graph)
  })
})

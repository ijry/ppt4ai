import { describe, expect, it } from 'vitest'
import type { Element, Fill, Ppt4aiDocument, Theme } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

const theme: Theme = {
  id: 'theme-1',
  colors: { accent1: { type: 'srgb', v: '4472C4' }, accent2: { type: 'srgb', v: 'ED7D31' } },
}

const bounds = { x: 0, y: 0, w: 2000000, h: 1000000 }

const gradientStroke: Fill = {
  color: { type: 'scheme', v: 'accent1' },
  gradient: {
    stops: [
      { pos: 0, color: { type: 'scheme', v: 'accent1' } },
      { pos: 100000, color: { type: 'scheme', v: 'accent2', transforms: [{ type: 'alpha', value: 50000 }] } },
    ],
    angle: 0,
    scaled: false,
  },
}

function documentWith(element: Element): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_gradient_stroke',
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

describe('gradient stroke in the scene graph', () => {
  /** The model already carried this from the linear gradient slice; only the scene was missing. */
  it('resolves every outline stop through the theme', () => {
    const node = shapeNode({ stroke: gradientStroke, strokeWidth: 76200 })

    expect(node.resolvedStrokeGradient).toEqual({
      stops: [
        { pos: 0, color: { rgb: '4472C4', alpha: 100000 } },
        { pos: 100000, color: { rgb: 'ED7D31', alpha: 50000 } },
      ],
      angle: 0,
      scaled: false,
    })
  })

  /** The flat fallback stays, so a consumer reading only the colour still paints something. */
  it('keeps the resolved outline colour alongside the gradient', () => {
    expect(shapeNode({ stroke: gradientStroke }).resolvedStrokeColor).toEqual({ rgb: '4472C4', alpha: 100000 })
  })

  it('carries no gradient for a plain outline', () => {
    const node = shapeNode({ stroke: { color: { type: 'srgb', v: '203864' } } })

    expect(node.resolvedStrokeColor).toEqual({ rgb: '203864', alpha: 100000 })
    expect(node).not.toHaveProperty('resolvedStrokeGradient')
  })

  it('drops the gradient when fewer than two stops resolve', () => {
    const node = shapeNode({
      stroke: {
        color: { type: 'srgb', v: '203864' },
        gradient: {
          stops: [
            { pos: 0, color: { type: 'srgb', v: '203864' } },
            { pos: 100000, color: { type: 'scheme', v: 'missingSlot' } },
          ],
        },
      },
    })

    expect(node).not.toHaveProperty('resolvedStrokeGradient')
    expect(node.resolvedStrokeColor).toEqual({ rgb: '203864', alpha: 100000 })
  })

  /** A solid theme entry still supplies no gradient, even though gradient line entries now can. */
  it('carries no gradient from a solid theme line reference', () => {
    const withTheme = documentWith({
      id: 'el_shape', kind: 'shape', preset: 'rect', bounds,
      styleRef: { line: { idx: 1, color: { type: 'scheme', v: 'accent1' } } },
    })
    withTheme.themes!['theme-1']!.formatScheme = { lineStyles: [{ color: { type: 'scheme', v: 'phClr' }, width: 6350 }] }
    const node = documentToSceneGraph(withTheme).nodes[0]

    if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
    expect(node.resolvedStrokeColor).toEqual({ rgb: '4472C4', alpha: 100000 })
    expect(node).not.toHaveProperty('resolvedStrokeGradient')
  })

  it('resolves a gradient outline on a shape that carries text', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_text',
      kind: 'text',
      preset: 'roundRect',
      bounds,
      body: { paragraphs: [{ runs: [{ text: 'Label' }] }] },
      stroke: gradientStroke,
      strokeWidth: 38100,
    })).nodes[0]

    if (node?.kind !== 'text') throw new Error('fixture did not build a text node')
    expect(node.resolvedStrokeGradient?.stops).toHaveLength(2)
    expect(node.path?.length).toBeGreaterThan(0)
  })

  it('keeps the scene structured-clone safe', () => {
    const graph = documentToSceneGraph(documentWith({
      id: 'el_shape', kind: 'shape', preset: 'rect', bounds, stroke: gradientStroke,
    }))

    expect(structuredClone(graph)).toEqual(graph)
  })
})

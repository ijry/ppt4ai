import { describe, expect, it } from 'vitest'
import type { Element, Ppt4aiDocument, Theme } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

const theme: Theme = {
  id: 'theme-1',
  colors: { accent1: { type: 'srgb', v: '4472C4' } },
  formatScheme: {
    lineStyles: [
      { color: { type: 'scheme', v: 'phClr' }, width: 6350 },
      { color: { type: 'scheme', v: 'phClr' }, width: 12700, style: 'dash' },
      null,
      { color: { type: 'scheme', v: 'phClr' } },
    ],
  },
}

function documentWith(element: Element): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_line_style',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [element.id], layoutId: 'lyt_1' } },
    slideOrder: ['sld_1'],
    elements: { [element.id]: element },
    layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } },
    masters: { mst_1: { id: 'mst_1', themeId: 'theme-1' } },
    themes: { 'theme-1': theme },
  }
}

const bounds = { x: 1000000, y: 1000000, w: 2000000, h: 1000000 }
const accent1 = { type: 'scheme' as const, v: 'accent1' }

function shapeNode(overrides: Partial<Extract<Element, { kind: 'shape' }>> = {}) {
  const node = documentToSceneGraph(documentWith({
    id: 'el_shape', kind: 'shape', preset: 'rect', bounds, ...overrides,
  })).nodes[0]
  if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
  return node
}

describe('theme line styles in the scene graph', () => {
  /** The stock Office shape: spPr is empty and every stroke property comes from the matrix. */
  it('takes width and dash from the entry a lnRef points at', () => {
    const node = shapeNode({ styleRef: { line: { idx: 2, color: accent1 } } })

    expect(node.resolvedStrokeColor).toEqual({ rgb: '4472C4', alpha: 100000 })
    expect(node.strokeWidth).toBe(12700)
    expect(node.strokeStyle).toBe('dash')
  })

  it('prefers the element own width and dash over the entry', () => {
    const node = shapeNode({
      styleRef: { line: { idx: 2, color: accent1 } },
      strokeWidth: 76200,
      strokeStyle: 'dot',
    })

    expect(node.strokeWidth).toBe(76200)
    expect(node.strokeStyle).toBe('dot')
  })

  /**
   * The core of the merge rule: a direct `a:ln` overrides only what it declares. Recolouring an
   * outline without restating the width must not knock it back to a hairline.
   */
  it('falls back per property, not as a block', () => {
    const widthOnly = shapeNode({ styleRef: { line: { idx: 2, color: accent1 } }, strokeWidth: 76200 })
    expect(widthOnly.strokeWidth).toBe(76200)
    expect(widthOnly.strokeStyle).toBe('dash')

    const dashOnly = shapeNode({ styleRef: { line: { idx: 2, color: accent1 } }, strokeStyle: 'dot' })
    expect(dashOnly.strokeWidth).toBe(12700)
    expect(dashOnly.strokeStyle).toBe('dot')
  })

  it('takes only the width when the entry declares no dash', () => {
    const node = shapeNode({ styleRef: { line: { idx: 1, color: accent1 } } })

    expect(node.strokeWidth).toBe(6350)
    expect(node).not.toHaveProperty('strokeStyle')
  })

  it('carries nothing when the entry declares neither', () => {
    const node = shapeNode({ styleRef: { line: { idx: 4, color: accent1 } } })

    expect(node.resolvedStrokeColor).toEqual({ rgb: '4472C4', alpha: 100000 })
    expect(node).not.toHaveProperty('strokeWidth')
    expect(node).not.toHaveProperty('strokeStyle')
  })

  /** `idx="0"` is OOXML for "none", and a null entry has no width to lend. */
  it('carries nothing for index zero, an out-of-range index or a null entry', () => {
    for (const idx of [0, 3, 9]) {
      const node = shapeNode({ styleRef: { line: { idx, color: accent1 } } })

      expect(node).not.toHaveProperty('strokeWidth')
      expect(node).not.toHaveProperty('strokeStyle')
    }
  })

  it('resolves the entry for a shape that carries text', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_text',
      kind: 'text',
      preset: 'roundRect',
      bounds,
      body: { paragraphs: [{ runs: [{ text: 'Styled' }] }] },
      styleRef: { line: { idx: 2, color: accent1 } },
    })).nodes[0]

    if (node?.kind !== 'text') throw new Error('fixture did not build a text node')
    expect(node.strokeWidth).toBe(12700)
    expect(node.strokeStyle).toBe('dash')
  })

  it('keeps the scene structured-clone safe', () => {
    const graph = documentToSceneGraph(documentWith({
      id: 'el_shape', kind: 'shape', preset: 'rect', bounds, styleRef: { line: { idx: 2, color: accent1 } },
    }))

    expect(structuredClone(graph)).toEqual(graph)
  })
})

import { describe, expect, it } from 'vitest'
import type { Element, Ppt4aiDocument, Theme } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

const theme: Theme = {
  id: 'theme-1',
  colors: { accent1: { type: 'srgb', v: '4472C4' }, accent2: { type: 'srgb', v: 'ED7D31' } },
  formatScheme: {
    fillStyles: [{ color: { type: 'scheme', v: 'phClr' } }, null],
    lineStyles: [{ color: { type: 'scheme', v: 'phClr' } }],
  },
}

function documentWith(element: Element): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_style',
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
const accent1Ref = { idx: 1, color: { type: 'scheme' as const, v: 'accent1' } }

describe('style matrix in the scene graph', () => {
  it('fills a shape that only carries a style reference', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_shape',
      kind: 'shape',
      preset: 'rect',
      bounds,
      styleRef: { fill: accent1Ref, line: { idx: 1, color: { type: 'scheme', v: 'accent2' } } },
    })).nodes[0]

    if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
    expect(node.resolvedFillColor).toEqual({ rgb: '4472C4', alpha: 100000 })
    expect(node.resolvedStrokeColor).toEqual({ rgb: 'ED7D31', alpha: 100000 })
  })

  /** Direct formatting wins, which is OOXML's rule for `spPr` against `p:style`. */
  it('prefers a direct fill over the style reference', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_shape',
      kind: 'shape',
      preset: 'rect',
      bounds,
      fill: { color: { type: 'srgb', v: '112233' } },
      styleRef: { fill: accent1Ref },
    })).nodes[0]

    if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
    expect(node.resolvedFillColor).toEqual({ rgb: '112233', alpha: 100000 })
  })

  it('fills a text element from its style reference and builds the geometry', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_text',
      kind: 'text',
      preset: 'roundRect',
      bounds,
      body: { paragraphs: [{ runs: [{ text: 'Styled' }] }] },
      styleRef: { fill: accent1Ref },
    })).nodes[0]

    if (node?.kind !== 'text') throw new Error('fixture did not build a text node')
    expect(node.resolvedFillColor).toEqual({ rgb: '4472C4', alpha: 100000 })
    expect(node.path?.length).toBeGreaterThan(0)
  })

  it('leaves a shape unfilled when the reference points at an entry it cannot express', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_shape',
      kind: 'shape',
      preset: 'rect',
      bounds,
      styleRef: { fill: { idx: 2, color: { type: 'scheme', v: 'accent1' } } },
    })).nodes[0]

    expect(node).not.toHaveProperty('resolvedFillColor')
  })

  it('keeps the scene structured-clone safe', () => {
    const graph = documentToSceneGraph(documentWith({
      id: 'el_shape', kind: 'shape', preset: 'rect', bounds, styleRef: { fill: accent1Ref },
    }))

    expect(structuredClone(graph)).toEqual(graph)
  })
})

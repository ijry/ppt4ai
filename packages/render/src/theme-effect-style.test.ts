import type { Element, Ppt4aiDocument, Theme } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { documentToSceneGraph } from './index'

const theme: Theme = {
  id: 'theme-1',
  colors: { accent1: { type: 'srgb', v: '4472C4' } },
  formatScheme: {
    fillStyles: [{ color: { type: 'scheme', v: 'phClr' } }],
    effectStyles: [
      null,
      { color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'alpha', value: 40000 }] }, blurRadius: 57150, distance: 19050, direction: 5400000 },
    ],
  },
}

function documentWith(element: Element): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_effect_ref',
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
const styleRef = { fill: { idx: 1, color: accent1 }, effect: { idx: 2, color: accent1 } }
const themeShadow = { color: { rgb: '4472C4', alpha: 40000 }, blurRadius: 57150, distance: 19050, direction: 5400000 }

describe('effectRef in the scene graph', () => {
  it('gives a shape with only an effectRef the theme entry shadow', () => {
    const node = documentToSceneGraph(documentWith({ id: 'el_shape', kind: 'shape', preset: 'rect', bounds, styleRef })).nodes[0]

    if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
    expect(node.shadow).toEqual(themeShadow)
  })

  /** Direct formatting wins whole: an `a:effectLst` in the file replaces the gallery's list. */
  it('lets the element declaration win over the reference', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_shape',
      kind: 'shape',
      preset: 'rect',
      bounds,
      styleRef,
      shadow: { color: { type: 'srgb', v: '000000' }, distance: 12700 },
    })).nodes[0]

    if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
    expect(node.shadow).toEqual({ color: { rgb: '000000', alpha: 100000 }, distance: 12700 })
  })

  it('resolves the reference on a text node too', () => {
    const node = documentToSceneGraph(documentWith({ id: 'el_text', kind: 'text', bounds, text: 'Titled', styleRef })).nodes[0]

    if (node?.kind !== 'text') throw new Error('fixture did not build a text node')
    expect(node.shadow).toEqual(themeShadow)
  })

  it('resolves nothing when the reference points at a null entry', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_shape',
      kind: 'shape',
      preset: 'rect',
      bounds,
      styleRef: { fill: { idx: 1, color: accent1 }, effect: { idx: 1, color: accent1 } },
    })).nodes[0]

    if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
    expect(node.shadow).toBeUndefined()
  })
})

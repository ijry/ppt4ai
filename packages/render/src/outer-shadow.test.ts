import type { Element, Ppt4aiDocument, Theme } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { documentToSceneGraph } from './index'

const theme: Theme = { id: 'theme-1', colors: { dk1: { type: 'srgb', v: '1F1F1F' } } }

function documentWith(element: Element): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_shadow',
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

describe('outer shadow in the scene graph', () => {
  it('resolves the shadow colour through the theme and carries the measurements', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_shape',
      kind: 'shape',
      preset: 'rect',
      bounds,
      fill: { color: { type: 'srgb', v: '4472C4' } },
      shadow: { color: { type: 'scheme', v: 'tx1' }, blurRadius: 50800, distance: 38100, direction: 2700000 },
    })).nodes[0]

    if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
    expect(node.shadow).toEqual({
      color: { rgb: '1F1F1F', alpha: 100000 },
      blurRadius: 50800,
      distance: 38100,
      direction: 2700000,
    })
  })

  it('carries the shadow on a text node too', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_text',
      kind: 'text',
      bounds,
      text: 'Titled',
      fill: { color: { type: 'srgb', v: '4472C4' } },
      shadow: { color: { type: 'srgb', v: '000000' }, distance: 12700 },
    })).nodes[0]

    if (node?.kind !== 'text') throw new Error('fixture did not build a text node')
    expect(node.shadow).toEqual({ color: { rgb: '000000', alpha: 100000 }, distance: 12700 })
  })

  /** A colour the theme cannot answer would paint an invented shadow, so the whole shadow drops. */
  it('drops a shadow whose colour will not resolve', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_shape',
      kind: 'shape',
      preset: 'rect',
      bounds,
      shadow: { color: { type: 'scheme', v: 'nope' }, distance: 12700 },
    })).nodes[0]

    if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
    expect(node.shadow).toBeUndefined()
  })

  it('leaves a shape without a shadow alone', () => {
    const node = documentToSceneGraph(documentWith({
      id: 'el_shape',
      kind: 'shape',
      preset: 'rect',
      bounds,
      fill: { color: { type: 'srgb', v: '4472C4' } },
    })).nodes[0]

    if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
    expect(node.shadow).toBeUndefined()
  })
})

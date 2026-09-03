import { describe, expect, it } from 'vitest'
import type { Ppt4aiDocument, SlideBackground } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

function documentWith(background: SlideBackground | undefined, masterBackground?: SlideBackground): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_background',
    page: { w: 12192000, h: 6858000 },
    slides: {
      sld_1: {
        id: 'sld_1',
        elementIds: [],
        layoutId: 'lyt_1',
        ...(background ? { background } : {}),
      },
    },
    slideOrder: ['sld_1'],
    elements: {},
    layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } },
    masters: { mst_1: { id: 'mst_1', themeId: 'theme-1', ...(masterBackground ? { background: masterBackground } : {}) } },
    themes: {
      'theme-1': {
        id: 'theme-1',
        colors: { lt1: { type: 'srgb', v: 'FFFFFF' } },
        formatScheme: { backgroundStyles: [{ color: { type: 'scheme', v: 'phClr' } }] },
      },
    },
  }
}

describe('slide background in the scene graph', () => {
  it('resolves the slide background onto the graph', () => {
    const graph = documentToSceneGraph(documentWith({ fill: { color: { type: 'srgb', v: '1F3864' } } }))

    expect(graph.background).toEqual({ rgb: '1F3864', alpha: 100000 })
  })

  it('falls back to the master background style reference', () => {
    const graph = documentToSceneGraph(documentWith(undefined, { styleRef: { idx: 1001, color: { type: 'scheme', v: 'lt1' } } }))

    expect(graph.background).toEqual({ rgb: 'FFFFFF', alpha: 100000 })
  })

  it('omits the background when nothing declares one', () => {
    expect(documentToSceneGraph(documentWith(undefined))).not.toHaveProperty('background')
  })

  it('keeps the scene structured-clone safe', () => {
    const graph = documentToSceneGraph(documentWith({ fill: { color: { type: 'scheme', v: 'lt1' } } }))

    expect(structuredClone(graph)).toEqual(graph)
  })
})

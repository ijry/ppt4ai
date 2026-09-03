import { describe, expect, it } from 'vitest'
import type { Fill, Ppt4aiDocument, SlideBackground, Theme } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

const page = { w: 9144000, h: 6858000 }

const verticalGradient: Fill = {
  color: { type: 'srgb', v: '4472C4' },
  gradient: {
    stops: [
      { pos: 0, color: { type: 'srgb', v: '4472C4' } },
      { pos: 100000, color: { type: 'srgb', v: '203864' } },
    ],
    angle: 5400000,
    scaled: false,
  },
}

function documentWith(background: SlideBackground): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_gradient_background',
    page,
    slides: { sld_1: { id: 'sld_1', elementIds: [], background } },
    slideOrder: ['sld_1'],
    elements: {},
  }
}

describe('gradient background in the scene graph', () => {
  /** Before this the background resolved to the first stop and painted flat. */
  it('resolves the stops alongside the flat fallback colour', () => {
    const scene = documentToSceneGraph(documentWith({ fill: verticalGradient }))

    expect(scene.background).toEqual({ rgb: '4472C4', alpha: 100000 })
    expect(scene.backgroundGradient).toEqual({
      stops: [
        { pos: 0, color: { rgb: '4472C4', alpha: 100000 } },
        { pos: 100000, color: { rgb: '203864', alpha: 100000 } },
      ],
      angle: 5400000,
      scaled: false,
    })
  })

  it('carries no gradient for a plain background fill', () => {
    const scene = documentToSceneGraph(documentWith({ fill: { color: { type: 'srgb', v: '1F3864' } } }))

    expect(scene.background).toEqual({ rgb: '1F3864', alpha: 100000 })
    expect(scene).not.toHaveProperty('backgroundGradient')
  })

  /** One stop is not a ramp, so the page keeps the flat colour rather than a one-stop gradient. */
  it('drops the gradient when fewer than two stops survive', () => {
    const scene = documentToSceneGraph(documentWith({
      fill: {
        color: { type: 'srgb', v: '4472C4' },
        gradient: { stops: [{ pos: 0, color: { type: 'srgb', v: '4472C4' } }] },
      },
    }))

    expect(scene.background).toEqual({ rgb: '4472C4', alpha: 100000 })
    expect(scene).not.toHaveProperty('backgroundGradient')
  })

  it('carries nothing when the slide declares no background at all', () => {
    const bare: Ppt4aiDocument = {
      format: 'ppt4ai',
      version: 1,
      id: 'dck_bare',
      page,
      slides: { sld_1: { id: 'sld_1', elementIds: [] } },
      slideOrder: ['sld_1'],
      elements: {},
    }

    expect(documentToSceneGraph(bare)).not.toHaveProperty('backgroundGradient')
  })
})

const theme: Theme = {
  id: 'thm_1',
  colors: { dk1: { type: 'srgb', v: '000000' }, lt1: { type: 'srgb', v: 'FFFFFF' } },
}

describe('gradient background inheritance', () => {
  /** `p:bg` replaces whole, so the nearest of slide, layout and master supplies the gradient too. */
  it('inherits the gradient from the layout when the slide declares none', () => {
    const document: Ppt4aiDocument = {
      format: 'ppt4ai',
      version: 1,
      id: 'dck_layout_background',
      page,
      slides: { sld_1: { id: 'sld_1', elementIds: [], layoutId: 'lyt_1' } },
      slideOrder: ['sld_1'],
      elements: {},
      layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1', background: { fill: verticalGradient } } },
      masters: { mst_1: { id: 'mst_1' } },
    }

    const scene = documentToSceneGraph(document)

    expect(scene.background).toEqual({ rgb: '4472C4', alpha: 100000 })
    expect(scene.backgroundGradient?.stops).toHaveLength(2)
  })

  it('resolves master gradient stops through the theme', () => {
    const document: Ppt4aiDocument = {
      format: 'ppt4ai',
      version: 1,
      id: 'dck_master_background',
      page,
      slides: { sld_1: { id: 'sld_1', elementIds: [], layoutId: 'lyt_1' } },
      slideOrder: ['sld_1'],
      elements: {},
      layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } },
      masters: {
        mst_1: {
          id: 'mst_1',
          themeId: 'thm_1',
          background: {
            fill: {
              color: { type: 'scheme', v: 'tx1' },
              gradient: {
                stops: [
                  { pos: 0, color: { type: 'scheme', v: 'tx1' } },
                  { pos: 100000, color: { type: 'scheme', v: 'bg1' } },
                ],
                angle: 16200000,
              },
            },
          },
        },
      },
      themes: { thm_1: theme },
    }

    const scene = documentToSceneGraph(document)

    expect(scene.backgroundGradient).toEqual({
      stops: [
        { pos: 0, color: { rgb: '000000', alpha: 100000 } },
        { pos: 100000, color: { rgb: 'FFFFFF', alpha: 100000 } },
      ],
      angle: 16200000,
    })
  })

  it('keeps the scene structured-clone safe', () => {
    const scene = documentToSceneGraph(documentWith({ fill: verticalGradient }))

    expect(structuredClone(scene)).toEqual(scene)
  })
})

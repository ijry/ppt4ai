import { describe, expect, it } from 'vitest'
import type { Fill, Ppt4aiDocument, SlideBackground, Theme } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

const page = { w: 9144000, h: 6858000 }

const patternFill: Fill = {
  color: { type: 'srgb', v: '4472C4' },
  pattern: {
    preset: 'ltHorz',
    foreground: { type: 'srgb', v: '4472C4' },
    background: { type: 'srgb', v: 'FFFFFF' },
  },
}

function documentWith(background: SlideBackground): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_pattern_background',
    page,
    slides: { sld_1: { id: 'sld_1', elementIds: [], background } },
    slideOrder: ['sld_1'],
    elements: {},
  }
}

describe('pattern background in the scene graph', () => {
  it('resolves both pattern colours alongside the flat fallback', () => {
    const scene = documentToSceneGraph(documentWith({ fill: patternFill }))

    expect(scene.background).toEqual({ rgb: '4472C4', alpha: 100000 })
    expect(scene.backgroundPattern).toEqual({
      preset: 'ltHorz',
      foreground: { rgb: '4472C4', alpha: 100000 },
      background: { rgb: 'FFFFFF', alpha: 100000 },
    })
  })

  it('carries no pattern for a plain background fill', () => {
    const scene = documentToSceneGraph(documentWith({ fill: { color: { type: 'srgb', v: '1F3864' } } }))

    expect(scene).not.toHaveProperty('backgroundPattern')
  })

  it('drops the pattern when the effective fill is a gradient', () => {
    const scene = documentToSceneGraph(documentWith({
      fill: {
        ...patternFill,
        gradient: {
          stops: [
            { pos: 0, color: { type: 'srgb', v: '4472C4' } },
            { pos: 100000, color: { type: 'srgb', v: '203864' } },
          ],
        },
      },
    }))

    expect(scene).not.toHaveProperty('backgroundPattern')
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

    expect(documentToSceneGraph(bare)).not.toHaveProperty('backgroundPattern')
  })

  it('keeps the scene structured-clone safe', () => {
    const scene = documentToSceneGraph(documentWith({ fill: patternFill }))

    expect(structuredClone(scene)).toEqual(scene)
  })
})

const theme: Theme = {
  id: 'thm_1',
  colors: {
    dk1: { type: 'srgb', v: '000000' },
    lt1: { type: 'srgb', v: 'FFFFFF' },
    accent1: { type: 'srgb', v: '204060' },
  },
  formatScheme: {
    backgroundStyles: [
      {
        color: { type: 'scheme', v: 'phClr' },
        pattern: {
          preset: 'pct25',
          foreground: { type: 'scheme', v: 'phClr' },
          background: { type: 'scheme', v: 'lt1' },
        },
      },
      null,
    ],
  },
}

describe('pattern background inheritance', () => {
  it('resolves a master background style reference through the theme and phClr', () => {
    const document: Ppt4aiDocument = {
      format: 'ppt4ai',
      version: 1,
      id: 'dck_master_pattern',
      page,
      slides: { sld_1: { id: 'sld_1', elementIds: [], layoutId: 'lyt_1' } },
      slideOrder: ['sld_1'],
      elements: {},
      layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } },
      masters: {
        mst_1: {
          id: 'mst_1',
          themeId: 'thm_1',
          background: { styleRef: { idx: 1001, color: { type: 'scheme', v: 'accent1' } } },
        },
      },
      themes: { thm_1: theme },
    }

    const scene = documentToSceneGraph(document)

    expect(scene.backgroundPattern).toEqual({
      preset: 'pct25',
      foreground: { rgb: '204060', alpha: 100000 },
      background: { rgb: 'FFFFFF', alpha: 100000 },
    })
  })
})

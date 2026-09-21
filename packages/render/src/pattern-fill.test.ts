import { describe, expect, it } from 'vitest'
import type { Fill, Ppt4aiDocument, ShapeStyleReference, Theme } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

function documentWith(shape: { fill?: Fill; styleRef?: ShapeStyleReference }, theme?: Theme): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_pattern',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_shape'], layoutId: 'lyt_1' } },
    slideOrder: ['sld_1'],
    elements: {
      el_shape: {
        id: 'el_shape',
        kind: 'shape',
        bounds: { x: 0, y: 0, w: 1000000, h: 1000000 },
        preset: 'rect',
        ...shape,
      },
    },
    layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } },
    masters: { mst_1: { id: 'mst_1', themeId: 'theme-1' } },
    themes: { 'theme-1': theme ?? { id: 'theme-1', colors: {} } },
  }
}

function shapeNode(document: Ppt4aiDocument) {
  const node = documentToSceneGraph(document).nodes[0]
  if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
  return node
}

const redPattern: Fill = {
  color: { type: 'srgb', v: 'FF0000' },
  pattern: {
    preset: 'ltHorz',
    foreground: { type: 'srgb', v: 'FF0000' },
    background: { type: 'srgb', v: '00FF00' },
  },
}

describe('pattern fill in the scene graph', () => {
  it('resolves both pattern colours', () => {
    const node = shapeNode(documentWith({ fill: redPattern }))

    expect(node.resolvedFillPattern).toEqual({
      preset: 'ltHorz',
      foreground: { rgb: 'FF0000', alpha: 100000 },
      background: { rgb: '00FF00', alpha: 100000 },
    })
  })

  /** The flat fallback every consumer already reads, so a pattern paints as its foreground today. */
  it('keeps the resolved fill colour set to the foreground', () => {
    expect(shapeNode(documentWith({ fill: redPattern })).resolvedFillColor).toEqual({ rgb: 'FF0000', alpha: 100000 })
  })

  it('leaves the pattern absent for a plain fill', () => {
    const node = shapeNode(documentWith({ fill: { color: { type: 'srgb', v: '123456' } } }))

    expect(node.resolvedFillPattern).toBeUndefined()
    expect(node.resolvedFillColor).toEqual({ rgb: '123456', alpha: 100000 })
  })

  /** `phClr` in a theme entry has to become the reference's own colour, as the gradient entries do. */
  it('substitutes phClr in a theme fill style entry reached through fillRef', () => {
    const theme: Theme = {
      id: 'theme-1',
      colors: { accent1: { type: 'srgb', v: '4472C4' } },
      formatScheme: {
        fillStyles: [
          null,
          {
            color: { type: 'scheme', v: 'phClr' },
            pattern: {
              preset: 'dkUpDiag',
              foreground: { type: 'scheme', v: 'phClr' },
              background: { type: 'srgb', v: 'FFFFFF' },
            },
          },
        ],
      },
    }
    const node = shapeNode(documentWith({ styleRef: { fill: { idx: 2, color: { type: 'scheme', v: 'accent1' } } } }, theme))

    expect(node.resolvedFillPattern).toEqual({
      preset: 'dkUpDiag',
      foreground: { rgb: '4472C4', alpha: 100000 },
      background: { rgb: 'FFFFFF', alpha: 100000 },
    })
  })

  /** Direct formatting wins over the theme entry, the same order the fill colour and gradient follow. */
  it('prefers the element pattern over the theme entry', () => {
    const theme: Theme = {
      id: 'theme-1',
      colors: {},
      formatScheme: {
        fillStyles: [{
          color: { type: 'srgb', v: '000000' },
          pattern: {
            preset: 'pct50',
            foreground: { type: 'srgb', v: '000000' },
            background: { type: 'srgb', v: 'FFFFFF' },
          },
        }],
      },
    }
    const node = shapeNode(documentWith({ fill: redPattern, styleRef: { fill: { idx: 1 } } }, theme))

    expect(node.resolvedFillPattern?.preset).toBe('ltHorz')
  })
})

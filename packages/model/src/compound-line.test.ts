import { describe, expect, it } from 'vitest'
import { validateDocument, type Ppt4aiDocument } from './index'

function documentWith(stroke: Record<string, unknown>): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_validate',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_1'] } },
    slideOrder: ['sld_1'],
    elements: {
      el_1: { id: 'el_1', kind: 'shape', preset: 'rect', bounds: { x: 0, y: 0, w: 100, h: 100 }, ...stroke },
    },
  } as unknown as Ppt4aiDocument
}

function errorsFor(stroke: Record<string, unknown>): string[] {
  const result = validateDocument(documentWith(stroke))
  return result.valid ? [] : result.errors
}

describe('compound line validation', () => {
  it('accepts every compound token', () => {
    for (const token of ['sng', 'dbl', 'thickThin', 'thinThick', 'tri']) {
      expect(errorsFor({ strokeCompound: token }), token).toEqual([])
    }
  })

  it('accepts both alignment tokens', () => {
    expect(errorsFor({ strokeAlign: 'ctr' })).toEqual([])
    expect(errorsFor({ strokeAlign: 'in' })).toEqual([])
  })

  it('rejects a compound word it does not know', () => {
    expect(errorsFor({ strokeCompound: 'quadruple' }))
      .toContain('elements.el_1.strokeCompound must be a supported compound line token')
  })

  it('rejects an alignment word it does not know', () => {
    expect(errorsFor({ strokeAlign: 'outside' })).toContain('elements.el_1.strokeAlign must be ctr or in')
  })

  it('validates the same two fields on a theme line style entry', () => {
    const document = {
      format: 'ppt4ai',
      version: 1,
      id: 'dck_validate',
      page: { w: 12192000, h: 6858000 },
      slides: { sld_1: { id: 'sld_1', elementIds: [] } },
      slideOrder: ['sld_1'],
      elements: {},
      themes: {
        'theme-1': {
          id: 'theme-1',
          colors: {},
          formatScheme: {
            lineStyles: [{ color: { type: 'srgb', v: 'FF0000' }, compound: 'quintuple', align: 'sideways' }],
          },
        },
      },
    } as unknown as Ppt4aiDocument
    const result = validateDocument(document)

    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.errors).toContain('themes.theme-1.formatScheme.lineStyles[0].compound must be a supported compound line token')
    expect(result.errors).toContain('themes.theme-1.formatScheme.lineStyles[0].align must be ctr or in')
  })
})

import { describe, expect, it } from 'vitest'
import { validateDocument, type Ppt4aiDocument } from './index'

const minimalDocument: Ppt4aiDocument = {
  format: 'ppt4ai',
  version: 1,
  id: 'dck_1',
  page: { w: 12192000, h: 6858000 },
  slides: {
    sld_1: { id: 'sld_1', elementIds: ['el_shape'] },
  },
  elements: {
    el_shape: {
      id: 'el_shape',
      kind: 'shape',
      preset: 'rect',
      bounds: { x: 1000000, y: 1000000, w: 4000000, h: 2000000 },
      fill: { color: { type: 'srgb', v: '4472C4' } },
    },
  },
  slideOrder: ['sld_1'],
}

describe('ppt4ai file model', () => {
  it('accepts a minimal JSON file and rejects broken slide order', () => {
    expect(validateDocument(minimalDocument)).toEqual({ valid: true })
    expect(validateDocument({ ...minimalDocument, slideOrder: ['missing'] })).toEqual({
      valid: false,
      errors: ['slideOrder references missing slide: missing'],
    })
  })

  it('keeps the contract structured-clone safe', () => {
    expect(structuredClone(minimalDocument)).toEqual(minimalDocument)
  })

  it('reports duplicate and dangling element references', () => {
    const broken = {
      ...minimalDocument,
      slides: {
        sld_1: { id: 'sld_1', elementIds: ['el_shape', 'el_shape', 'missing'] },
      },
    }

    expect(validateDocument(broken)).toEqual({
      valid: false,
      errors: [
        'slide sld_1 references duplicate element: el_shape',
        'slide sld_1 references missing element: missing',
      ],
    })
  })
})

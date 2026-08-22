import { describe, expect, it } from 'vitest'
import { resolveInheritedElement, validateDocument, type Ppt4aiDocument, type SlideLayout, type SlideMaster } from './index'

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

  it('resolves explicit properties over layout and master defaults', () => {
    const element = {
      id: 'el_title',
      kind: 'text' as const,
      bounds: { x: 1, y: 2, w: 3, h: 4 },
      text: 'Slide title',
      placeholder: 'title',
    }
    const master: SlideMaster = {
      id: 'master_1',
      defaults: { title: { fill: { color: { type: 'srgb', v: '000000' } } } },
    }
    const layout: SlideLayout = {
      id: 'layout_1',
      masterId: 'master_1',
      defaults: { title: { fill: { color: { type: 'srgb', v: 'FFFFFF' } } } },
    }

    expect(resolveInheritedElement(element, layout, master)).toMatchObject({
      fill: { color: { type: 'srgb', v: 'FFFFFF' } },
    })
    expect(resolveInheritedElement({ ...element, fill: { color: { type: 'srgb', v: 'FF0000' } } }, layout, master)).toMatchObject({
      fill: { color: { type: 'srgb', v: 'FF0000' } },
    })
    const resolved = resolveInheritedElement(element, layout, master)
    expect(structuredClone(resolved)).toEqual(resolved)
  })
})

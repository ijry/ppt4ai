import { describe, expect, it } from 'vitest'
import {
  resolveInheritedElement,
  validateDocument,
  validateTextBody,
  type Ppt4aiDocument,
  type SlideLayout,
  type SlideMaster,
  type TextElement,
} from './index'

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
  it('accepts JSON-safe text bodies and body-only text elements', () => {
    const body = {
      bodyPr: {
        insets: { left: 100, top: 200, right: 300, bottom: 400 },
        verticalAlign: 'middle' as const,
        wrap: 'square' as const,
        autofit: { type: 'shrink' as const, minFontScale: 60000 },
      },
      paragraphs: [{
        attrs: { align: 'center' as const, level: 1, lineSpacing: 120000, spaceAfter: 500 },
        runs: [{ text: 'Hello', marks: { fontFamily: 'Arial', fontSize: 20, bold: true } }],
      }],
    }
    const element: TextElement = {
      id: 'el_text',
      kind: 'text',
      bounds: { x: 0, y: 0, w: 1000, h: 1000 },
      body,
    }

    expect(validateTextBody(body)).toEqual({ valid: true })
    expect(structuredClone(element)).toEqual(element)
  })

  it('accepts horizontal and vertical writing modes as clone-safe body properties', () => {
    const vertical = { bodyPr: { vertical: 'vertical' as const }, paragraphs: [{ runs: [{ text: '中文' }] }] }
    const horizontal = { bodyPr: { vertical: 'horizontal' as const }, paragraphs: [{ runs: [{ text: 'text' }] }] }

    expect(validateTextBody(vertical)).toEqual({ valid: true })
    expect(validateTextBody(horizontal)).toEqual({ valid: true })
    expect(structuredClone(vertical)).toEqual(vertical)
  })

  it('reports a deterministic path for invalid writing modes', () => {
    expect(validateTextBody({
      bodyPr: { vertical: 'diagonal' },
      paragraphs: [{ runs: [{ text: 'invalid' }] }],
    })).toEqual({
      valid: false,
      errors: ['bodyPr.vertical must be horizontal or vertical'],
    })
    expect(validateTextBody({
      bodyPr: { vertical: 90 },
      paragraphs: [{ runs: [{ text: 'invalid' }] }],
    })).toEqual({
      valid: false,
      errors: ['bodyPr.vertical must be horizontal or vertical'],
    })
  })

  it('accepts clone-safe character and automatic numbering bullets', () => {
    const body = {
      paragraphs: [
        { attrs: { bullet: { type: 'char' as const, char: '•', fontFamily: 'Arial' }, level: 0 }, runs: [{ text: 'one' }] },
        { attrs: { bullet: { type: 'autoNum' as const, scheme: 'arabic' as const, startAt: 3 }, level: 0 }, runs: [{ text: 'three' }] },
        { attrs: { bullet: { type: 'autoNum' as const, scheme: 'alphaLower' as const }, level: 1 }, runs: [{ text: 'a' }] },
        { attrs: { bullet: { type: 'autoNum' as const, scheme: 'alphaUpper' as const } }, runs: [{ text: 'A' }] },
      ],
    }

    expect(validateTextBody(body)).toEqual({ valid: true })
    expect(structuredClone(body)).toEqual(body)
  })

  it('reports deterministic bullet validation paths', () => {
    expect(validateTextBody({
      paragraphs: [{
        attrs: {
          bullet: { type: 'char', char: 'ab', fontFamily: '' },
          level: 1.5,
        },
        runs: [{ text: 'invalid' }],
      }, {
        attrs: { bullet: { type: 'autoNum', scheme: 'roman', startAt: 0 } },
        runs: [{ text: 'invalid' }],
      }],
    })).toEqual({
      valid: false,
      errors: [
        'paragraphs[0].attrs.level must be non-negative integer',
        'paragraphs[0].attrs.bullet.char must contain exactly one Unicode code point',
        'paragraphs[0].attrs.bullet.fontFamily must be non-empty',
        'paragraphs[1].attrs.bullet.scheme must be arabic, alphaLower, or alphaUpper',
        'paragraphs[1].attrs.bullet.startAt must be a positive integer',
      ],
    })
  })

  it('reports deterministic paths for invalid text body values', () => {
    expect(validateTextBody({
      bodyPr: {
        insets: { left: -1, top: 0, right: 0, bottom: 0 },
        autofit: { type: 'shrink', minFontScale: 0 },
      },
      paragraphs: [{
        attrs: { level: -1, lineSpacing: 0, spaceBefore: -1 },
        runs: [{ text: '', marks: { fontSize: 0, baseline: Number.NaN } }],
      }],
    })).toEqual({
      valid: false,
      errors: [
        'paragraphs[0].runs[0].text must be non-empty',
        'paragraphs[0].runs[0].marks.fontSize must be positive',
        'paragraphs[0].runs[0].marks.baseline must be finite',
        'paragraphs[0].attrs.level must be non-negative integer',
        'paragraphs[0].attrs.spaceBefore must be non-negative',
        'paragraphs[0].attrs.lineSpacing must be positive',
        'bodyPr.insets.left must be non-negative',
        'bodyPr.autofit.minFontScale must be between 1 and 100000',
      ],
    })
  })

  it('requires at least one paragraph and validates resize maximum height', () => {
    expect(validateTextBody({ bodyPr: { autofit: { type: 'resize', maxHeight: -1 } }, paragraphs: [] })).toEqual({
      valid: false,
      errors: [
        'paragraphs must be non-empty',
        'bodyPr.autofit.maxHeight must be positive',
      ],
    })
  })

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

  it('validates flat groups and their child references', () => {
    const grouped = {
      ...minimalDocument,
      slides: { sld_1: { id: 'sld_1', elementIds: ['grp_1'] } },
      elements: {
        ...minimalDocument.elements,
        el_b: {
          id: 'el_b',
          kind: 'shape' as const,
          preset: 'ellipse' as const,
          bounds: { x: 6000000, y: 1000000, w: 1000000, h: 1000000 },
        },
        grp_1: {
          id: 'grp_1',
          kind: 'group' as const,
          bounds: { x: 1000000, y: 1000000, w: 6000000, h: 2000000 },
          childIds: ['el_shape', 'el_b'],
        },
      },
    }
    expect(validateDocument(grouped)).toEqual({ valid: true })
    expect(validateDocument({ ...grouped, elements: { ...grouped.elements, grp_1: { ...grouped.elements.grp_1, childIds: ['el_shape', 'el_shape'] } } })).toEqual({
      valid: false,
      errors: ['group grp_1 references duplicate child: el_shape'],
    })
  })

  it('rejects cyclic group references', () => {
    const cyclic = {
      ...minimalDocument,
      slides: { sld_1: { id: 'sld_1', elementIds: ['grp_a'] } },
      elements: {
        ...minimalDocument.elements,
        grp_a: {
          id: 'grp_a',
          kind: 'group' as const,
          bounds: { x: 0, y: 0, w: 100, h: 100 },
          childIds: ['grp_b'],
        },
        grp_b: {
          id: 'grp_b',
          kind: 'group' as const,
          bounds: { x: 0, y: 0, w: 100, h: 100 },
          childIds: ['grp_a'],
        },
      },
    }

    expect(validateDocument(cyclic)).toEqual({
      valid: false,
      errors: ['group cycle detected: grp_a -> grp_b -> grp_a'],
    })
  })
})

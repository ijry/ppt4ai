import { describe, expect, it } from 'vitest'
import { validateDocument, type Fill, type Ppt4aiDocument } from './index'

function documentWith(field: 'fill' | 'stroke', paint: unknown): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_element_paint',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_shape'] } },
    slideOrder: ['sld_1'],
    elements: {
      el_shape: {
        id: 'el_shape',
        kind: 'shape',
        preset: 'rect',
        bounds: { x: 0, y: 0, w: 100, h: 100 },
        [field]: paint,
      },
    },
  } as unknown as Ppt4aiDocument
}

function errorsFor(field: 'fill' | 'stroke', paint: unknown): string[] {
  const result = validateDocument(documentWith(field, paint))
  return result.valid ? [] : result.errors
}

const solid: Fill = { color: { type: 'srgb', v: '4472C4' } }

const ramp: Fill = {
  color: { type: 'srgb', v: '4472C4' },
  gradient: {
    stops: [
      { pos: 0, color: { type: 'srgb', v: '4472C4' } },
      { pos: 100000, color: { type: 'srgb', v: '203864' } },
    ],
  },
}

/**
 * Element `fill` and `stroke` were never run through `validateFill` before commands could set them.
 * The gradient slice recorded that as a known hole; adding the paint commands made it reachable.
 */
describe('element paint validation', () => {
  it('accepts a solid and a gradient paint on both fields', () => {
    for (const field of ['fill', 'stroke'] as const) {
      expect(errorsFor(field, solid)).toEqual([])
      expect(errorsFor(field, ramp)).toEqual([])
    }
  })

  it('rejects a malformed colour', () => {
    expect(errorsFor('fill', { color: { type: 'nope', v: 'x' } }).length).toBeGreaterThan(0)
    expect(errorsFor('stroke', { color: { type: 'srgb', v: 'not-hex' } }).length).toBeGreaterThan(0)
  })

  it('rejects a paint that is not an object', () => {
    expect(errorsFor('fill', 'blue')).toContain('elements.el_shape.fill must be an object')
    expect(errorsFor('stroke', 'blue')).toContain('elements.el_shape.stroke must be an object')
  })

  it('rejects a paint with no colour', () => {
    expect(errorsFor('fill', {})).toContain('elements.el_shape.fill.color must be an object')
  })

  /** The gradient rules now bite where they matter most, on an element's own paint. */
  it('rejects a gradient with fewer than two stops', () => {
    expect(errorsFor('fill', {
      color: { type: 'srgb', v: '4472C4' },
      gradient: { stops: [{ pos: 0, color: { type: 'srgb', v: '4472C4' } }] },
    })).toContain('elements.el_shape.fill.gradient.stops must have at least two entries')
  })

  it('rejects a stop position outside the modeled range', () => {
    expect(errorsFor('stroke', {
      color: { type: 'srgb', v: '4472C4' },
      gradient: {
        stops: [
          { pos: 0, color: { type: 'srgb', v: '4472C4' } },
          { pos: 100001, color: { type: 'srgb', v: '203864' } },
        ],
      },
    })).toContain('elements.el_shape.stroke.gradient.stops[1].pos must be an integer between 0 and 100000')
  })

  it('accepts an element with no paint at all', () => {
    const bare: Ppt4aiDocument = {
      format: 'ppt4ai',
      version: 1,
      id: 'dck_bare',
      page: { w: 12192000, h: 6858000 },
      slides: { sld_1: { id: 'sld_1', elementIds: ['el_shape'] } },
      slideOrder: ['sld_1'],
      elements: { el_shape: { id: 'el_shape', kind: 'shape', preset: 'rect', bounds: { x: 0, y: 0, w: 100, h: 100 } } },
    }

    expect(validateDocument(bare).valid).toBe(true)
  })
})

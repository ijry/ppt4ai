import { describe, expect, it } from 'vitest'
import { validateDocument, type OuterShadow, type Ppt4aiDocument } from './index'

function errorsFor(shadow: unknown): string[] {
  const document = {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_shadow',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_shape'] } },
    slideOrder: ['sld_1'],
    elements: {
      el_shape: { id: 'el_shape', kind: 'shape', preset: 'rect', bounds: { x: 0, y: 0, w: 100, h: 100 }, shadow },
    },
  } as unknown as Ppt4aiDocument
  const result = validateDocument(document)
  return result.valid ? [] : result.errors
}

const shadow: OuterShadow = { color: { type: 'srgb', v: '000000' }, blurRadius: 50800, distance: 38100, direction: 2700000 }

describe('outer shadow validation', () => {
  it('accepts a shadow with and without measurements', () => {
    expect(errorsFor(shadow)).toEqual([])
    expect(errorsFor({ color: { type: 'scheme', v: 'tx1' } })).toEqual([])
  })

  /** A negative direction is a legal angle; a negative length is not a legal EMU measurement. */
  it('accepts a negative direction and rejects negative lengths', () => {
    expect(errorsFor({ ...shadow, direction: -2700000 })).toEqual([])
    expect(errorsFor({ ...shadow, blurRadius: -1 })).toContain('elements.el_shape.shadow.blurRadius must be a non-negative integer')
    expect(errorsFor({ ...shadow, distance: -1 })).toContain('elements.el_shape.shadow.distance must be a non-negative integer')
  })

  it('rejects non-integer measurements', () => {
    expect(errorsFor({ ...shadow, blurRadius: 1.5 })).toContain('elements.el_shape.shadow.blurRadius must be a non-negative integer')
    expect(errorsFor({ ...shadow, direction: 0.5 })).toContain('elements.el_shape.shadow.direction must be an integer')
  })

  it('rejects a missing or malformed colour', () => {
    expect(errorsFor({ blurRadius: 50800 }).length).toBeGreaterThan(0)
    expect(errorsFor({ color: { type: 'nope', v: 'x' } }).length).toBeGreaterThan(0)
  })

  it('rejects a shadow that is not an object', () => {
    expect(errorsFor('soft')).toContain('elements.el_shape.shadow must be an object')
  })
})

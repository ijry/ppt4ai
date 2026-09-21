import { describe, expect, it } from 'vitest'
import { colorTransformValueIsValid, resolveColor, validateDocument, type Color, type Ppt4aiDocument } from './index'

const accent: Color = { type: 'srgb', v: '4472C4' }

function resolved(transforms: { type: string; value: number }[]): string | undefined {
  return resolveColor({ ...accent, transforms })?.rgb
}

/**
 * The seven-word whitelist plus a `0..100000` cap dropped `satMod` twice over, so Office's own
 * `<a:satMod val="160000"/>` neither reached the file on the way out nor changed a pixel on the way in.
 */
describe('colour transform maths', () => {
  it('leaves the colour alone with no transforms', () => {
    expect(resolved([])).toBe('4472C4')
  })

  it('applies satMod and satOff in the same space the lum pair uses', () => {
    const base = resolved([])
    const saturated = resolved([{ type: 'satMod', value: 160000 }])
    const flattened = resolved([{ type: 'satMod', value: 0 }])

    expect(saturated).not.toBe(base)
    // Saturation zero is grey: all three channels equal.
    expect(flattened?.slice(0, 2)).toBe(flattened?.slice(2, 4))
    expect(flattened?.slice(2, 4)).toBe(flattened?.slice(4, 6))
    expect(resolved([{ type: 'satOff', value: 50000 }])).not.toBe(base)
  })

  it('accepts a Mod value above 100000, which is where satMod used to be lost', () => {
    expect(colorTransformValueIsValid('satMod', 160000)).toBe(true)
    expect(colorTransformValueIsValid('lumMod', 160000)).toBe(true)
    expect(resolved([{ type: 'satMod', value: 160000 }])).toBeDefined()
  })

  it('applies hueMod as an angle scale', () => {
    expect(resolved([{ type: 'hueMod', value: 50000 }])).not.toBe(resolved([]))
    // A full-scale hueMod is the identity, which is a useful check that the modulo is not shifting.
    expect(resolved([{ type: 'hueMod', value: 100000 }])).toBe(resolved([]))
  })

  /** Preserved but not computed: the maths for these is not verifiable here, so nothing is invented. */
  it('carries a transform it cannot compute without changing the colour', () => {
    for (const type of ['hue', 'hueOff', 'comp', 'inv', 'gray', 'gamma', 'redMod']) {
      expect(resolved([{ type, value: 40000 }])).toBe('4472C4')
    }
  })

  /** Switch-shaped transforms have no value; dividing `undefined` would resolve the colour to NaN. */
  it('carries a valueless switch without touching the colour', () => {
    expect(resolveColor({ ...accent, transforms: [{ type: 'gray' }, { type: 'inv' }, { type: 'comp' }] })?.rgb).toBe('4472C4')
    expect(resolveColor({ ...accent, transforms: [{ type: 'gray' }, { type: 'lumMod', value: 75000 }] })?.rgb).toBe('2F5597')
  })

  it('keeps the existing families working', () => {
    expect(resolved([{ type: 'lumMod', value: 75000 }])).toBe('2F5597')
    expect(resolved([{ type: 'shade', value: 50000 }])).toBe('223962')
    expect(resolveColor({ ...accent, transforms: [{ type: 'alpha', value: 40000 }] })?.alpha).toBe(40000)
  })
})

function errorsFor(transforms: unknown): string[] {
  const document = {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_transforms',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_shape'] } },
    slideOrder: ['sld_1'],
    elements: {
      el_shape: {
        id: 'el_shape',
        kind: 'shape',
        preset: 'rect',
        bounds: { x: 0, y: 0, w: 100, h: 100 },
        fill: { color: { type: 'srgb', v: '4472C4', transforms } },
      },
    },
  } as unknown as Ppt4aiDocument
  const result = validateDocument(document)
  return result.valid ? [] : result.errors
}

describe('colour transform validation', () => {
  it('accepts any token type and a Mod value above the percentage cap', () => {
    expect(errorsFor([{ type: 'satMod', value: 160000 }, { type: 'comp', value: 0 }])).toEqual([])
  })

  it('keeps the fixed-percentage range for alpha, tint and shade', () => {
    expect(errorsFor([{ type: 'alpha', value: 100001 }]).length).toBeGreaterThan(0)
    expect(errorsFor([{ type: 'tint', value: -1 }]).length).toBeGreaterThan(0)
    expect(errorsFor([{ type: 'shade', value: 100000 }])).toEqual([])
  })

  it('rejects a non-integer value, a negative Mod and a type that is not a token', () => {
    expect(errorsFor([{ type: 'satMod', value: 1.5 }]).length).toBeGreaterThan(0)
    expect(errorsFor([{ type: 'satMod', value: -1 }]).length).toBeGreaterThan(0)
    expect(errorsFor([{ type: 'not a token!', value: 1 }])).toContain('elements.el_shape.fill.color.transforms[0].type must be a color transform token')
  })

  it('accepts a transform with no value at all', () => {
    expect(errorsFor([{ type: 'comp' }, { type: 'gray' }])).toEqual([])
  })

  /** `*Off` is signed in the schema, so a negative offset is legal where a negative `*Mod` is not. */
  it('accepts a signed Off value', () => {
    expect(errorsFor([{ type: 'satOff', value: -20000 }, { type: 'lumOff', value: -20000 }])).toEqual([])
  })
})

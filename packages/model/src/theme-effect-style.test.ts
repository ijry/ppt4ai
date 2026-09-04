import { describe, expect, it } from 'vitest'
import { resolveStyleEffect, validateDocument, type Ppt4aiDocument, type Theme } from './index'

const theme: Theme = {
  id: 'theme-1',
  colors: { dk1: { type: 'srgb', v: '1F1F1F' }, accent1: { type: 'srgb', v: '4472C4' } },
  formatScheme: {
    effectStyles: [
      null,
      { color: { type: 'srgb', v: '000000', transforms: [{ type: 'alpha', value: 63000 }] }, blurRadius: 57150, distance: 19050, direction: 5400000 },
      { color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'alpha', value: 40000 }] }, blurRadius: 76200 },
    ],
  },
}

describe('resolveStyleEffect', () => {
  it('resolves the entry an effectRef points at', () => {
    expect(resolveStyleEffect({ idx: 2 }, theme)).toEqual({
      color: { rgb: '000000', alpha: 63000 },
      blurRadius: 57150,
      distance: 19050,
      direction: 5400000,
    })
  })

  /** Office's own entry is `phClr` with an alpha: without substitution the shadow would vanish. */
  it('substitutes phClr with the reference colour and keeps both alphas', () => {
    expect(resolveStyleEffect({ idx: 3, color: { type: 'scheme', v: 'accent1' } }, theme)).toEqual({
      color: { rgb: '4472C4', alpha: 40000 },
      blurRadius: 76200,
    })
  })

  it('resolves nothing for a null entry, idx 0, an out-of-range index or no reference', () => {
    expect(resolveStyleEffect({ idx: 1 }, theme)).toBeUndefined()
    expect(resolveStyleEffect({ idx: 0 }, theme)).toBeUndefined()
    expect(resolveStyleEffect({ idx: 9 }, theme)).toBeUndefined()
    expect(resolveStyleEffect(undefined, theme)).toBeUndefined()
  })

  /** A `phClr` entry with no reference colour has no colour at all, so it paints nothing. */
  it('resolves nothing when phClr has nothing to stand for', () => {
    expect(resolveStyleEffect({ idx: 3 }, theme)).toBeUndefined()
  })

  it('resolves nothing without a theme', () => {
    expect(resolveStyleEffect({ idx: 2 })).toBeUndefined()
  })
})

function errorsFor(effectStyles: unknown): string[] {
  const document = {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_effect_styles',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [] } },
    slideOrder: ['sld_1'],
    elements: {},
    themes: { 'theme-1': { id: 'theme-1', colors: {}, formatScheme: { effectStyles } } },
  } as unknown as Ppt4aiDocument
  const result = validateDocument(document)
  return result.valid ? [] : result.errors
}

describe('theme effect style validation', () => {
  it('accepts null entries and real shadows', () => {
    expect(errorsFor([null, { color: { type: 'srgb', v: '000000' }, blurRadius: 12700 }])).toEqual([])
  })

  it('rejects a list that is not an array and an entry that is not a shadow', () => {
    expect(errorsFor('none')).toContain('themes.theme-1.formatScheme.effectStyles must be an array')
    expect(errorsFor([{ blurRadius: 12700 }]).length).toBeGreaterThan(0)
    expect(errorsFor([{ color: { type: 'srgb', v: '000000' }, distance: -1 }]))
      .toContain('themes.theme-1.formatScheme.effectStyles[0].distance must be a non-negative integer')
  })
})

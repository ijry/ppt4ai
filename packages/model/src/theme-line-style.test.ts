import { describe, expect, it } from 'vitest'
import { resolveStyleLineStroke, validateDocument, type Ppt4aiDocument, type Theme } from './index'

const theme: Theme = {
  id: 'theme-1',
  colors: { accent1: { type: 'srgb', v: '4472C4' } },
  formatScheme: {
    lineStyles: [
      { color: { type: 'scheme', v: 'phClr' }, width: 6350 },
      { color: { type: 'scheme', v: 'phClr' }, width: 12700, style: 'dash' },
      null,
      { color: { type: 'scheme', v: 'phClr' } },
    ],
  },
}

const reference = (idx: number) => ({ idx, color: { type: 'scheme' as const, v: 'accent1' } })

describe('theme line style resolution', () => {
  it('reads the width and dash of the entry the reference points at', () => {
    expect(resolveStyleLineStroke(reference(1), theme)).toEqual({ width: 6350 })
    expect(resolveStyleLineStroke(reference(2), theme)).toEqual({ width: 12700, style: 'dash' })
  })

  /** An entry that declares neither has nothing to lend, so the caller sees no object at all. */
  it('resolves an entry with neither field to nothing', () => {
    expect(resolveStyleLineStroke(reference(4), theme)).toBeUndefined()
  })

  /** `idx="0"` is OOXML for "none", and a null entry carries no width to inherit. */
  it('resolves index zero, a null entry and an out-of-range index to nothing', () => {
    expect(resolveStyleLineStroke(reference(0), theme)).toBeUndefined()
    expect(resolveStyleLineStroke(reference(3), theme)).toBeUndefined()
    expect(resolveStyleLineStroke(reference(9), theme)).toBeUndefined()
  })

  it('resolves nothing without a reference, a theme or a format scheme', () => {
    expect(resolveStyleLineStroke(undefined, theme)).toBeUndefined()
    expect(resolveStyleLineStroke(reference(1))).toBeUndefined()
    expect(resolveStyleLineStroke(reference(1), { id: 't', colors: {} })).toBeUndefined()
  })

  /** Unlike the colour, the width does not need the reference to supply a `phClr` substitute. */
  it('reads the width from a reference that carries no colour', () => {
    expect(resolveStyleLineStroke({ idx: 2 }, theme)).toEqual({ width: 12700, style: 'dash' })
  })
})

function documentWith(lineStyles: unknown): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_validate',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [] } },
    slideOrder: ['sld_1'],
    elements: {},
    themes: { 'theme-1': { id: 'theme-1', colors: {}, formatScheme: { lineStyles } } },
  } as unknown as Ppt4aiDocument
}

function errorsFor(lineStyles: unknown): string[] {
  const result = validateDocument(documentWith(lineStyles))
  return result.valid ? [] : result.errors
}

describe('theme line style validation', () => {
  it('accepts an entry carrying a width and a dash', () => {
    expect(errorsFor([{ color: { type: 'srgb', v: '4472C4' }, width: 6350, style: 'dot' }])).toEqual([])
  })

  it('rejects a width that is not a non-negative integer', () => {
    expect(errorsFor([{ color: { type: 'srgb', v: '4472C4' }, width: -1 }]))
      .toContain('themes.theme-1.formatScheme.lineStyles[0].width must be a non-negative integer')
    expect(errorsFor([{ color: { type: 'srgb', v: '4472C4' }, width: 1.5 }]))
      .toContain('themes.theme-1.formatScheme.lineStyles[0].width must be a non-negative integer')
  })

  it('rejects a dash outside the three modeled styles', () => {
    expect(errorsFor([{ color: { type: 'srgb', v: '4472C4' }, style: 'lgDashDot' }]))
      .toContain('themes.theme-1.formatScheme.lineStyles[0].style must be solid, dash, or dot')
  })

  it('still applies the fill rules to the entry colour', () => {
    expect(errorsFor([{ color: { type: 'nope', v: 'x' }, width: 6350 }]).length).toBeGreaterThan(0)
  })

  it('accepts a null entry', () => {
    expect(errorsFor([null])).toEqual([])
  })
})

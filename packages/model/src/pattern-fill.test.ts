import { describe, expect, it } from 'vitest'
import { PAINTED_PRESET_PATTERNS, validateDocument, type Ppt4aiDocument } from './index'

/**
 * Validated through the slide background for the same reason the gradient rules are: element `fill`
 * and `stroke` never reach `validateFill`. The background, table cell and theme entry paths all share
 * it, so covering it once here covers the pattern rules everywhere they apply.
 */
function documentWith(pattern: unknown): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_validate',
    page: { w: 12192000, h: 6858000 },
    slides: {
      sld_1: {
        id: 'sld_1',
        elementIds: [],
        background: { fill: { color: { type: 'srgb', v: 'FF0000' }, pattern } },
      },
    },
    slideOrder: ['sld_1'],
    elements: {},
  } as unknown as Ppt4aiDocument
}

function errorsFor(pattern: unknown): string[] {
  const result = validateDocument(documentWith(pattern))
  return result.valid ? [] : result.errors
}

const valid = {
  preset: 'ltHorz',
  foreground: { type: 'srgb', v: 'FF0000' },
  background: { type: 'srgb', v: '00FF00' },
}

describe('pattern fill validation', () => {
  it('accepts a pattern with a preset and both colours', () => {
    expect(errorsFor(valid)).toEqual([])
  })

  /** The model preserves the OOXML word rather than policing the 54-word enumeration. */
  it('accepts a preset word it does not recognise', () => {
    expect(errorsFor({ ...valid, preset: 'someFuturePattern' })).toEqual([])
  })

  it('rejects a missing or empty preset', () => {
    expect(errorsFor({ ...valid, preset: '' }))
      .toContain('slides.sld_1.background.fill.pattern.preset must be a non-empty string')
    expect(errorsFor({ foreground: valid.foreground, background: valid.background }))
      .toContain('slides.sld_1.background.fill.pattern.preset must be a non-empty string')
  })

  it('rejects a missing colour slot', () => {
    expect(errorsFor({ preset: 'ltHorz', background: valid.background }))
      .toContain('slides.sld_1.background.fill.pattern.foreground must be an object')
    expect(errorsFor({ preset: 'ltHorz', foreground: valid.foreground }))
      .toContain('slides.sld_1.background.fill.pattern.background must be an object')
  })

  it('runs each colour through the colour rules', () => {
    const errors = errorsFor({ ...valid, foreground: { type: 'srgb', v: 'not-a-colour' } })

    expect(errors.some((error) => error.startsWith('slides.sld_1.background.fill.pattern.foreground'))).toBe(true)
  })

  it('rejects a pattern that is not an object', () => {
    expect(errorsFor('ltHorz')).toContain('slides.sld_1.background.fill.pattern must be an object')
    expect(errorsFor([valid])).toContain('slides.sld_1.background.fill.pattern must be an object')
  })

  /** The line and percentage families paint; the decorative words stay flat. */
  it('lists the presets that paint as something other than a flat colour', () => {
    expect(PAINTED_PRESET_PATTERNS).toContain('ltHorz')
    expect(PAINTED_PRESET_PATTERNS).toContain('diagCross')
    expect(PAINTED_PRESET_PATTERNS).toContain('pct50')
    expect(PAINTED_PRESET_PATTERNS).not.toContain('zigZag')
    expect(PAINTED_PRESET_PATTERNS).not.toContain('weave')
  })
})

import type { ResolvedColor, ResolvedGradient, SlideBackground } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { backgroundColorFrom, backgroundGradientFrom, backgroundPatternFrom, slideBackgroundModel } from './slide-background-panel'

const navy: ResolvedColor = { rgb: '1F3864', alpha: 100000 }
const ramp: ResolvedGradient = {
  stops: [{ pos: 0, color: navy }, { pos: 100000, color: { rgb: 'FFFFFF', alpha: 100000 } }],
}

describe('slide background panel model', () => {
  it('reports a colour the slide declares itself', () => {
    const background: SlideBackground = { fill: { color: { type: 'srgb', v: '1F3864' } } }

    expect(slideBackgroundModel(background, navy)).toEqual({
      active: true,
      color: '#1F3864',
      kind: 'color',
      own: true,
      inherited: false,
      gradientStart: '#1F3864',
      gradientEnd: '#FFFFFF',
      gradientAngle: 0,
      patternPreset: 'ltHorz',
      patternForeground: '#1F3864',
      patternBackground: '#FFFFFF',
      patternPresets: expect.any(Array),
    })
  })

  /** The colour shown is the resolved one — what the reader sees — even when the slide declares nothing. */
  it('reports an inherited background with the resolved colour and nothing to clear', () => {
    expect(slideBackgroundModel(undefined, navy)).toMatchObject({ color: '#1F3864', own: false, inherited: true, kind: 'none' })
  })

  it('falls back to white when nothing in the chain resolves', () => {
    expect(slideBackgroundModel(undefined, undefined)).toMatchObject({ color: '#FFFFFF', kind: 'none' })
  })

  /** A swatch cannot express either of these, so the model says so instead of showing a first stop. */
  it('reports a gradient and a style reference as themselves', () => {
    const gradient: SlideBackground = {
      fill: {
        color: { type: 'srgb', v: '1F3864' },
        gradient: { stops: [{ pos: 0, color: { type: 'srgb', v: '1F3864' } }, { pos: 100000, color: { type: 'srgb', v: 'FFFFFF' } }] },
      },
    }

    expect(slideBackgroundModel(gradient, navy, ramp).kind).toBe('gradient')
    expect(slideBackgroundModel({ styleRef: { idx: 1001 } }, navy).kind).toBe('styleRef')
    // An inherited gradient counts as one too: the panel would otherwise offer to "keep" a flat colour.
    expect(slideBackgroundModel(undefined, navy, ramp).kind).toBe('gradient')
  })

  /** A pattern is not a swatch either: reporting its foreground as a colour would let the panel silently drop the tiling. */
  it('reports a pattern background as a pattern rather than a colour', () => {
    const pattern: SlideBackground = {
      fill: {
        color: { type: 'srgb', v: '1F3864' },
        pattern: {
          preset: 'ltHorz',
          foreground: { type: 'srgb', v: '1F3864' },
          background: { type: 'srgb', v: 'FFFFFF' },
        },
      },
    }

    expect(slideBackgroundModel(pattern, navy).kind).toBe('pattern')
  })

  /** An inherited pattern counts too, the same way an inherited gradient does. */
  it('reports an inherited pattern as a pattern', () => {
    const resolvedPattern = { preset: 'ltHorz' as const, foreground: navy, background: { rgb: 'FFFFFF', alpha: 100000 } }
    expect(slideBackgroundModel(undefined, navy, undefined, true, resolvedPattern).kind).toBe('pattern')
  })

  it('passes the active flag through for a host with no slide', () => {
    expect(slideBackgroundModel(undefined, undefined, undefined, false).active).toBe(false)
  })
})

describe('background colour parsing', () => {
  it('accepts six hex digits with or without the hash', () => {
    expect(backgroundColorFrom('#1f3864')).toEqual({ type: 'srgb', v: '1F3864' })
    expect(backgroundColorFrom('1F3864')).toEqual({ type: 'srgb', v: '1F3864' })
  })

  it('refuses anything else rather than guessing', () => {
    expect(backgroundColorFrom('')).toBeUndefined()
    expect(backgroundColorFrom('#12345')).toBeUndefined()
    expect(backgroundColorFrom('navy')).toBeUndefined()
  })
})

describe('gradient background editor', () => {
  it('derives start, end and angle from a resolved gradient', () => {
    const model = slideBackgroundModel(
      { fill: { color: { type: 'srgb', v: '1F3864' }, gradient: { stops: [{ pos: 0, color: { type: 'srgb', v: '1F3864' } }, { pos: 100000, color: { type: 'srgb', v: 'FFFFFF' } }], angle: 5400000 } } },
      navy,
      { stops: [{ pos: 0, color: navy }, { pos: 100000, color: { rgb: 'FFFFFF', alpha: 100000 } }], angle: 5400000 },
    )
    expect(model).toMatchObject({ kind: 'gradient', gradientStart: '#1F3864', gradientEnd: '#FFFFFF', gradientAngle: 90 })
  })

  it('builds a two-stop linear gradient fill from the inputs', () => {
    expect(backgroundGradientFrom('#1f3864', '#ffffff', 90)).toEqual({
      color: { type: 'srgb', v: '1F3864' },
      gradient: { stops: [{ pos: 0, color: { type: 'srgb', v: '1F3864' } }, { pos: 100000, color: { type: 'srgb', v: 'FFFFFF' } }], angle: 5400000 },
    })
  })

  it('wraps the angle into 0..359 degrees', () => {
    expect(backgroundGradientFrom('#000000', '#ffffff', 450)?.gradient?.angle).toBe(90 * 60000)
    expect(backgroundGradientFrom('#000000', '#ffffff', -90)?.gradient?.angle).toBe(270 * 60000)
  })

  it('refuses an invalid swatch or a non-finite angle', () => {
    expect(backgroundGradientFrom('nope', '#ffffff', 0)).toBeUndefined()
    expect(backgroundGradientFrom('#000000', '#ffffff', Number.NaN)).toBeUndefined()
  })
})

describe('pattern background editor', () => {
  it('derives preset and swatches from a resolved pattern', () => {
    const model = slideBackgroundModel(
      { fill: { color: { type: 'srgb', v: 'FF0000' }, pattern: { preset: 'pct25', foreground: { type: 'srgb', v: 'FF0000' }, background: { type: 'srgb', v: 'FFFFFF' } } } },
      navy,
      undefined,
      true,
      { preset: 'pct25', foreground: { rgb: 'FF0000', alpha: 100000 }, background: { rgb: 'FFFFFF', alpha: 100000 } },
    )
    expect(model).toMatchObject({ kind: 'pattern', patternPreset: 'pct25', patternForeground: '#FF0000', patternBackground: '#FFFFFF' })
    expect(model.patternPresets).toContain('ltHorz')
  })

  it('builds a pattern fill, mirroring the foreground into the colour', () => {
    expect(backgroundPatternFrom('ltHorz', '#ff0000', '#ffffff')).toEqual({
      color: { type: 'srgb', v: 'FF0000' },
      pattern: { preset: 'ltHorz', foreground: { type: 'srgb', v: 'FF0000' }, background: { type: 'srgb', v: 'FFFFFF' } },
    })
  })

  it('refuses an unpainted preset or an invalid swatch', () => {
    expect(backgroundPatternFrom('someFuturePattern', '#000000', '#ffffff')).toBeUndefined()
    expect(backgroundPatternFrom('ltHorz', 'nope', '#ffffff')).toBeUndefined()
  })
})

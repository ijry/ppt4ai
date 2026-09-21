import { describe, expect, it } from 'vitest'
import { resolveSlideBackgroundPattern, type SlideBackground, type Theme } from './index'

const pattern = {
  preset: 'ltHorz',
  foreground: { type: 'srgb' as const, v: '204060' },
  background: { type: 'srgb' as const, v: 'FFFFFF' },
}

const theme: Theme = {
  id: 'theme-bg',
  colors: {
    accent1: { type: 'srgb', v: '204060' },
    lt1: { type: 'srgb', v: 'FFFFFF' },
  },
  formatScheme: {
    backgroundStyles: [
      {
        color: { type: 'scheme', v: 'phClr' },
        pattern: {
          preset: 'pct25',
          foreground: { type: 'scheme', v: 'phClr' },
          background: { type: 'scheme', v: 'lt1' },
        },
      },
      null,
    ],
  },
}

const slide = { id: 'sld_1', elementIds: [] }

describe('slide background pattern resolution', () => {
  it('resolves both colours of a direct background pattern', () => {
    const background: SlideBackground = { fill: { color: pattern.foreground, pattern } }

    expect(resolveSlideBackgroundPattern({ ...slide, background }, undefined, undefined, theme)).toEqual({
      preset: 'ltHorz',
      foreground: { rgb: '204060', alpha: 100000 },
      background: { rgb: 'FFFFFF', alpha: 100000 },
    })
  })

  it('resolves a background style reference through the offset index and phClr', () => {
    const background: SlideBackground = {
      styleRef: { idx: 1001, color: { type: 'scheme', v: 'accent1' } },
    }

    expect(resolveSlideBackgroundPattern({ ...slide, background }, undefined, undefined, theme)).toEqual({
      preset: 'pct25',
      foreground: { rgb: '204060', alpha: 100000 },
      background: { rgb: 'FFFFFF', alpha: 100000 },
    })
  })

  it('uses the nearest background whole instead of merging patterns down the chain', () => {
    const master = { id: 'mst_1', background: { fill: { color: pattern.foreground, pattern } } }
    const layoutPattern: SlideBackground = { fill: { color: pattern.foreground, pattern: { ...pattern, preset: 'dkHorz' } } }
    const slidePattern: SlideBackground = { fill: { color: pattern.foreground, pattern: { ...pattern, preset: 'vert' } } }

    expect(resolveSlideBackgroundPattern({ ...slide, background: slidePattern }, { id: 'lyt_1', masterId: 'mst_1', background: layoutPattern }, master, theme)?.preset).toBe('vert')
    expect(resolveSlideBackgroundPattern({ ...slide, background: { fill: { color: pattern.foreground } } }, { id: 'lyt_1', masterId: 'mst_1', background: layoutPattern }, master, theme)).toBeUndefined()
  })

  it('returns no pattern when the effective fill is a gradient', () => {
    const stops = [{ pos: 0, color: pattern.foreground }, { pos: 100000, color: pattern.background }]
    const direct: SlideBackground = { fill: { color: pattern.foreground, gradient: { stops }, pattern } }
    const referenced: Theme = {
      ...theme,
      formatScheme: {
        backgroundStyles: [{
          color: { type: 'scheme', v: 'phClr' },
          gradient: { stops },
          pattern,
        }],
      },
    }

    expect(resolveSlideBackgroundPattern({ ...slide, background: direct }, undefined, undefined, theme)).toBeUndefined()
    expect(resolveSlideBackgroundPattern({ ...slide, background: { styleRef: { idx: 1001 } } }, undefined, undefined, referenced)).toBeUndefined()
  })

  it('returns nothing for unresolved colours, missing references and invalid indexes', () => {
    const missingBackground: SlideBackground = {
      fill: {
        color: pattern.foreground,
        pattern: { preset: 'ltHorz', foreground: pattern.foreground, background: { type: 'scheme', v: 'missing' } },
      },
    }

    expect(resolveSlideBackgroundPattern({ ...slide, background: missingBackground }, undefined, undefined, theme)).toBeUndefined()
    expect(resolveSlideBackgroundPattern({ ...slide, background: { styleRef: { idx: 1000 } } }, undefined, undefined, theme)).toBeUndefined()
    expect(resolveSlideBackgroundPattern({ ...slide, background: { styleRef: { idx: 1002 } } }, undefined, undefined, theme)).toBeUndefined()
    expect(resolveSlideBackgroundPattern(slide, undefined, undefined, theme)).toBeUndefined()
  })
})
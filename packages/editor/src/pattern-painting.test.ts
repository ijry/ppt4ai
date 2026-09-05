import type { ResolvedPattern } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { paintPatternFill } from './shape-painting'

type Event = [string, ...unknown[]]

function fakeContext() {
  const events: Event[] = []
  return {
    events,
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    save(): void { events.push(['save']) },
    restore(): void { events.push(['restore']) },
    beginPath(): void { events.push(['beginPath']) },
    moveTo(x: number, y: number): void { events.push(['moveTo', x, y]) },
    lineTo(x: number, y: number): void { events.push(['lineTo', x, y]) },
    rect(): void {},
    roundRect(): void {},
    ellipse(): void {},
    closePath(): void {},
    clip(): void { events.push(['clip']) },
    fill(): void { events.push(['fill']) },
    fillRect(x: number, y: number, w: number, h: number): void { events.push(['fillRect', x, y, w, h, this.globalAlpha]) },
    stroke(): void { events.push(['stroke']) },
    setLineDash(): void {},
  }
}

const mapping = { scale: 1, offsetX: 0, offsetY: 0 }
const bounds = { x: 0, y: 0, w: 100, h: 100 }
const path = [{ type: 'move' as const, x: 0, y: 0 }, { type: 'line' as const, x: 100, y: 0 }, { type: 'close' as const }]

function pattern(preset: string): ResolvedPattern {
  return {
    preset,
    foreground: { rgb: 'FF0000', alpha: 100000 },
    background: { rgb: '00FF00', alpha: 100000 },
  }
}

function paint(preset: string) {
  const context = fakeContext()
  const painted = paintPatternFill(context as never, pattern(preset), path, mapping, bounds)
  return { painted, events: context.events, context }
}

describe('pattern fill painting', () => {
  /** Clip first, then the background, then the lines — the order paintPictureFill established. */
  it('clips to the path, fills the background, and strokes the lines', () => {
    const { painted, events } = paint('ltHorz')
    const names = events.map((event) => event[0])

    expect(painted).toBe(true)
    expect(names.indexOf('clip')).toBeLessThan(names.indexOf('fillRect'))
    expect(names.indexOf('fillRect')).toBeLessThan(names.indexOf('stroke'))
    expect(names).toContain('save')
    expect(names).toContain('restore')
  })

  /** The background colour was stored but never painted until this slice. */
  it('paints the background over the whole mapped box', () => {
    const { events } = paint('ltHorz')

    expect(events.find((event) => event[0] === 'fillRect')?.slice(0, 5)).toEqual(['fillRect', 0, 0, 100, 100])
  })

  it('draws one line segment per geometry line', () => {
    const { events } = paint('ltHorz')

    expect(events.filter((event) => event[0] === 'moveTo').length)
      .toBe(events.filter((event) => event[0] === 'lineTo').length)
    expect(events.filter((event) => event[0] === 'moveTo').length).toBeGreaterThan(1)
    expect(events.filter((event) => event[0] === 'stroke').length).toBe(1)
  })

  it('draws more lines for a narrow tier than for the base word', () => {
    const linesOf = (preset: string) => paint(preset).events.filter((event) => event[0] === 'moveTo').length

    expect(linesOf('narHorz')).toBeGreaterThan(linesOf('horz'))
  })

  it('leaves the foreground colour on the stroke and the background on the fill', () => {
    const context = fakeContext()
    paintPatternFill(context as never, pattern('ltHorz'), path, mapping, bounds)

    expect(context.strokeStyle).toBe('#FF0000')
    expect(context.lineWidth).toBe(1)
  })

  it('sets a heavier line for the dark tier', () => {
    const context = fakeContext()
    paintPatternFill(context as never, pattern('dkHorz'), path, mapping, bounds)

    expect(context.lineWidth).toBeGreaterThan(1)
  })

  /** The caller paints the flat foreground colour instead, which is what every pattern used to do. */
  it('reports false and paints nothing for a preset it cannot draw', () => {
    for (const preset of ['zigZag', 'weave', 'someFuturePattern']) {
      const { painted, events } = paint(preset)

      expect(painted, preset).toBe(false)
      expect(events, preset).toEqual([])
    }
  })

  describe('percentage presets', () => {
    /** Painted as the foreground at the stated coverage: one fillRect, no dither, no lines. */
    it('fills the foreground over the background instead of stroking lines', () => {
      const { painted, events } = paint('pct50')
      const names = events.map((event) => event[0])

      expect(painted).toBe(true)
      expect(names.filter((name) => name === 'fillRect').length).toBe(2)
      expect(names).not.toContain('stroke')
      expect(names.indexOf('clip')).toBeLessThan(names.indexOf('fillRect'))
    })

    it('uses the percentage the word states as the foreground alpha', () => {
      const foregroundFill = paint('pct50').events.filter((event) => event[0] === 'fillRect')[1]

      expect(foregroundFill?.[5]).toBe(0.5)
    })

    /** The bug this slice fixes: all twelve words painted identically, at full foreground. */
    it('paints a higher percentage more heavily than a lower one', () => {
      const alphaOf = (preset: string) => paint(preset).events.filter((event) => event[0] === 'fillRect')[1]?.[5] as number

      expect(alphaOf('pct90')).toBeGreaterThan(alphaOf('pct50'))
      expect(alphaOf('pct50')).toBeGreaterThan(alphaOf('pct5'))
    })

    it('multiplies the coverage by a translucent foreground colour', () => {
      const context = fakeContext()
      const translucent: ResolvedPattern = {
        preset: 'pct50',
        foreground: { rgb: 'FF0000', alpha: 50000 },
        background: { rgb: '00FF00', alpha: 100000 },
      }
      paintPatternFill(context as never, translucent, path, mapping, bounds)
      const foregroundFill = context.events.filter((event) => event[0] === 'fillRect')[1]

      expect(foregroundFill?.[5]).toBeCloseTo(0.25)
    })
  })

  it('reports false for a box with no area', () => {
    const context = fakeContext()

    expect(paintPatternFill(context as never, pattern('ltHorz'), path, mapping, { x: 0, y: 0, w: 0, h: 10 })).toBe(false)
    expect(context.events).toEqual([])
  })
})

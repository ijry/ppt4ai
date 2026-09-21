import type { TextMarks } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { paintTextLayout } from './text-painting'

type Event = [string, ...unknown[]]

class RecordingContext {
  readonly events: Event[] = []
  fillStyle: unknown = ''
  strokeStyle: unknown = ''
  globalAlpha = 1
  lineWidth = 1
  font = ''
  textAlign = 'left'
  textBaseline = 'alphabetic'

  save(): void {}
  restore(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  setLineDash(pattern: number[]): void { this.events.push(['setLineDash', ...pattern]) }
  stroke(): void { this.events.push(['stroke', this.lineWidth]) }
  fillText(): void {}
  measureText(): { width: number } { return { width: 10 } }
}

function paint(marks: TextMarks): RecordingContext {
  const context = new RecordingContext()
  paintTextLayout(context as unknown as CanvasRenderingContext2D, {
    bounds: { x: 0, y: 0, w: 400, h: 100 },
    fontScale: 100000,
    overflow: false,
    contentBounds: { x: 0, y: 0, w: 400, h: 100 },
    lines: [{ paragraphIndex: 0, x: 0, y: 0, width: 200, height: 20, runs: [{ text: 'Word', x: 0, width: 200, marks }] }],
  }, { scale: 1, offsetX: 0, offsetY: 0 })
  return context
}

function dashOf(context: RecordingContext): Event | undefined {
  return context.events.find((event) => event[0] === 'setLineDash')
}

/**
 * Every `@u` word except `none` used to collapse onto `single`, so the file's `dbl` came back as `sng`.
 * Painting now reads the word: two families get the dash lengths the outline painter already ships, and
 * the rest keep the one solid line they drew before.
 */
describe('underline painting', () => {
  it('draws nothing without an underline and for an explicit none', () => {
    expect(paint({ fontSize: 12 }).events.some(([name]) => name === 'stroke')).toBe(false)
    expect(paint({ fontSize: 12, underline: 'none' }).events.some(([name]) => name === 'stroke')).toBe(false)
  })

  it('draws a solid line for the words it cannot structure', () => {
    for (const underline of ['sng', 'dbl', 'heavy', 'wavy', 'words', 'wavyDbl']) {
      const context = paint({ fontSize: 12, underline })

      expect(context.events.some(([name]) => name === 'stroke')).toBe(true)
      expect(dashOf(context)).toEqual(['setLineDash'])
    }
  })

  it('dots the dotted family', () => {
    for (const underline of ['dotted', 'dottedHeavy']) {
      expect(dashOf(paint({ fontSize: 12, underline }))?.length).toBe(3)
    }
  })

  it('dashes the dashed and dot-dash families', () => {
    for (const underline of ['dash', 'dashLong', 'dotDash', 'dotDotDashHeavy']) {
      const dash = dashOf(paint({ fontSize: 12, underline }))

      expect(dash?.length).toBe(3)
      // A dash is longer than the dot pattern's first segment, which is how the two families differ.
      expect(dash?.[1]).toBeGreaterThan(dashOf(paint({ fontSize: 12, underline: 'dotted' }))?.[1] as number)
    }
  })

  /** The dash is reset after stroking, or the next run's line — or its text — would inherit it. */
  it('resets the dash pattern after drawing', () => {
    const context = paint({ fontSize: 12, underline: 'dotted' })
    const patterns = context.events.filter(([name]) => name === 'setLineDash')

    expect(patterns).toHaveLength(2)
    expect(patterns[1]).toEqual(['setLineDash'])
  })
})

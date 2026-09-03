import { describe, expect, it } from 'vitest'
import { validateDocument, type Ppt4aiDocument } from './index'

/**
 * Validated through the slide background, because element `fill` and `stroke` are not run through
 * `validateFill` at all — a pre-existing gap this slice does not close. The background, table cell
 * and theme entry paths do, and they all share `validateFill`, so the gradient rules are covered
 * once here.
 */
function documentWith(gradient: unknown): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_validate',
    page: { w: 12192000, h: 6858000 },
    slides: {
      sld_1: {
        id: 'sld_1',
        elementIds: [],
        background: { fill: { color: { type: 'srgb', v: '4472C4' }, gradient } },
      },
    },
    slideOrder: ['sld_1'],
    elements: {},
  } as unknown as Ppt4aiDocument
}

function errorsFor(gradient: unknown): string[] {
  const result = validateDocument(documentWith(gradient))
  return result.valid ? [] : result.errors
}

const path = 'slides.sld_1.background.fill.gradient'

const twoStops = [
  { pos: 0, color: { type: 'srgb', v: '4472C4' } },
  { pos: 100000, color: { type: 'srgb', v: '203864' } },
]

describe('gradient validation', () => {
  it('accepts a two-stop gradient with an angle and flag', () => {
    expect(errorsFor({ stops: twoStops, angle: 5400000, scaled: true })).toEqual([])
  })

  it('accepts a gradient with no angle or flag', () => {
    expect(errorsFor({ stops: twoStops })).toEqual([])
  })

  /** Fewer than two stops is a plain colour, so the gradient form is the wrong way to say it. */
  it('rejects fewer than two stops', () => {
    expect(errorsFor({ stops: [twoStops[0]] })).toContain(`${path}.stops must have at least two entries`)
  })

  it('rejects a non-array stops', () => {
    expect(errorsFor({ stops: 'ramp' })).toContain(`${path}.stops must be an array`)
  })

  it('rejects a position outside zero to one hundred thousand', () => {
    expect(errorsFor({ stops: [twoStops[0], { pos: 100001, color: { type: 'srgb', v: '203864' } }] }))
      .toContain(`${path}.stops[1].pos must be an integer between 0 and 100000`)
    expect(errorsFor({ stops: [{ pos: -1, color: { type: 'srgb', v: '4472C4' } }, twoStops[1]] }))
      .toContain(`${path}.stops[0].pos must be an integer between 0 and 100000`)
  })

  it('rejects a fractional position', () => {
    expect(errorsFor({ stops: [{ pos: 0.5, color: { type: 'srgb', v: '4472C4' } }, twoStops[1]] }))
      .toContain(`${path}.stops[0].pos must be an integer between 0 and 100000`)
  })

  it('rejects a stop with no usable colour', () => {
    expect(errorsFor({ stops: [{ pos: 0 }, twoStops[1]] })).toContain(`${path}.stops[0].color must be an object`)
    expect(errorsFor({ stops: [{ pos: 0, color: { type: 'nope', v: 'x' } }, twoStops[1]] }).length).toBeGreaterThan(0)
  })

  it('rejects a non-integer angle and a non-boolean flag', () => {
    expect(errorsFor({ stops: twoStops, angle: 1.5 })).toContain(`${path}.angle must be an integer`)
    expect(errorsFor({ stops: twoStops, scaled: 'yes' })).toContain(`${path}.scaled must be a boolean`)
  })

  it('rejects a gradient that is not an object', () => {
    expect(errorsFor('vertical')).toContain(`${path} must be an object`)
  })
})

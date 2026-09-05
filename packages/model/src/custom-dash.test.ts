import { describe, expect, it } from 'vitest'
import { validateDocument, type Ppt4aiDocument } from './index'

function documentWith(strokeStyle: unknown): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_validate',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_1'] } },
    slideOrder: ['sld_1'],
    elements: {
      el_1: {
        id: 'el_1',
        kind: 'shape',
        preset: 'rect',
        bounds: { x: 0, y: 0, w: 100, h: 100 },
        strokeStyle,
      },
    },
  } as unknown as Ppt4aiDocument
}

function errorsFor(strokeStyle: unknown): string[] {
  const result = validateDocument(documentWith(strokeStyle))
  return result.valid ? [] : result.errors
}

describe('custom dash validation', () => {
  it('accepts a segment list', () => {
    expect(errorsFor({ custom: [{ dash: 400000, space: 300000 }] })).toEqual([])
  })

  /** No ceiling: the percentages are relative to the line width, so over 100000 is ordinary. */
  it('accepts a segment longer than the line width', () => {
    expect(errorsFor({ custom: [{ dash: 800000, space: 1 }] })).toEqual([])
  })

  it('still accepts the eleven preset tokens', () => {
    expect(errorsFor('lgDashDotDot')).toEqual([])
  })

  it('rejects a word that is not a preset token', () => {
    expect(errorsFor('squiggle')).toContain('elements.el_1.strokeStyle must be a supported preset dash token')
  })

  it('rejects a non-positive or fractional length', () => {
    expect(errorsFor({ custom: [{ dash: 0, space: 100 }] }))
      .toContain('elements.el_1.strokeStyle.custom[0].dash must be a positive integer')
    expect(errorsFor({ custom: [{ dash: -5, space: 100 }] }))
      .toContain('elements.el_1.strokeStyle.custom[0].dash must be a positive integer')
    expect(errorsFor({ custom: [{ dash: 100, space: 1.5 }] }))
      .toContain('elements.el_1.strokeStyle.custom[0].space must be a positive integer')
  })

  it('reports the index of the offending segment', () => {
    expect(errorsFor({ custom: [{ dash: 100, space: 100 }, { dash: 100 }] }))
      .toContain('elements.el_1.strokeStyle.custom[1].space must be a positive integer')
  })

  it('rejects a custom form that is not a segment array', () => {
    expect(errorsFor({ custom: 'dashes' })).toContain('elements.el_1.strokeStyle.custom must be an array')
    expect(errorsFor([{ dash: 1, space: 1 }]))
      .toContain('elements.el_1.strokeStyle must be a string or { custom: DashSegment[] }')
  })
})

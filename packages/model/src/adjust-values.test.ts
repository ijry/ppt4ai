import { describe, expect, it } from 'vitest'
import { validateDocument, type Ppt4aiDocument } from './index'

function documentWith(adjustValues: unknown): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_validate',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_1'] } },
    slideOrder: ['sld_1'],
    elements: {
      el_1: { id: 'el_1', kind: 'shape', preset: 'roundRect', bounds: { x: 0, y: 0, w: 100, h: 100 }, adjustValues },
    },
  } as unknown as Ppt4aiDocument
}

function errorsFor(adjustValues: unknown): string[] {
  const result = validateDocument(documentWith(adjustValues))
  return result.valid ? [] : result.errors
}

describe('adjust value validation', () => {
  it('accepts a list of named formulas', () => {
    expect(errorsFor([{ name: 'adj', formula: 'val 25000' }])).toEqual([])
    expect(errorsFor([{ name: 'adj1', formula: 'val 1' }, { name: 'adj2', formula: 'pin 0 adj 50000' }])).toEqual([])
  })

  it('accepts an empty list', () => {
    expect(errorsFor([])).toEqual([])
  })

  it('rejects a list that is not an array', () => {
    expect(errorsFor({ adj: 'val 1' })).toContain('elements.el_1.adjustValues must be an array')
  })

  it('rejects an entry that is not an object', () => {
    expect(errorsFor(['val 25000'])).toContain('elements.el_1.adjustValues[0] must be an object')
  })

  it('rejects a missing or empty name', () => {
    expect(errorsFor([{ formula: 'val 1' }]))
      .toContain('elements.el_1.adjustValues[0].name must be a non-empty string')
    expect(errorsFor([{ name: '', formula: 'val 1' }]))
      .toContain('elements.el_1.adjustValues[0].name must be a non-empty string')
  })

  it('rejects a missing or blank formula', () => {
    expect(errorsFor([{ name: 'adj' }]))
      .toContain('elements.el_1.adjustValues[0].formula must be a non-empty string')
    expect(errorsFor([{ name: 'adj', formula: '   ' }]))
      .toContain('elements.el_1.adjustValues[0].formula must be a non-empty string')
  })

  it('reports the index of the offending entry', () => {
    expect(errorsFor([{ name: 'adj1', formula: 'val 1' }, { name: 'adj2' }]))
      .toContain('elements.el_1.adjustValues[1].formula must be a non-empty string')
  })
})

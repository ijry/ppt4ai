import { describe, expect, it } from 'vitest'
import { validateDocument, type Ppt4aiDocument } from './index'

function documentWith(defaults: Record<string, unknown>): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_validate',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [], layoutId: 'lyt_1' } },
    slideOrder: ['sld_1'],
    elements: {},
    layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1', defaults: { title: defaults } } },
    masters: { mst_1: { id: 'mst_1' } },
  } as unknown as Ppt4aiDocument
}

function errorsFor(defaults: Record<string, unknown>): string[] {
  const result = validateDocument(documentWith(defaults))
  return result.valid ? [] : result.errors
}

/**
 * A placeholder default carries the same vocabulary an element does, and until these rules were shared
 * none of it was checked here — `validateDocument` called a layout holding an unwritable token valid.
 */
describe('placeholder default validation', () => {
  it('accepts the whole vocabulary when it is well formed', () => {
    expect(errorsFor({
      preset: 'roundRect',
      strokeWidth: 76200,
      strokeStyle: 'lgDashDot',
      strokeCap: 'sq',
      strokeJoin: 'miter',
      strokeCompound: 'dbl',
      strokeAlign: 'in',
      strokeMiterLimit: 800000,
      adjustValues: [{ name: 'adj', formula: 'val 25000' }],
      stroke: { color: { type: 'srgb', v: '203864' } },
    })).toEqual([])
  })

  it('rejects a dash token no exporter could write', () => {
    expect(errorsFor({ strokeStyle: 'squiggle' }))
      .toContain('layouts.lyt_1.defaults.title.strokeStyle must be a supported preset dash token')
  })

  it('rejects a custom dash segment that is not a positive integer', () => {
    expect(errorsFor({ strokeStyle: { custom: [{ dash: 0, space: 100 }] } }))
      .toContain('layouts.lyt_1.defaults.title.strokeStyle.custom[0].dash must be a positive integer')
  })

  it('rejects each unknown line token', () => {
    expect(errorsFor({ strokeCap: 'blunt' })).toContain('layouts.lyt_1.defaults.title.strokeCap must be flat, rnd, or sq')
    expect(errorsFor({ strokeJoin: 'mitre' })).toContain('layouts.lyt_1.defaults.title.strokeJoin must be round, bevel, or miter')
    expect(errorsFor({ strokeCompound: 'quadruple' }))
      .toContain('layouts.lyt_1.defaults.title.strokeCompound must be a supported compound line token')
    expect(errorsFor({ strokeAlign: 'outside' })).toContain('layouts.lyt_1.defaults.title.strokeAlign must be ctr or in')
  })

  it('rejects an unusable width or miter limit', () => {
    expect(errorsFor({ strokeWidth: -1 })).toContain('layouts.lyt_1.defaults.title.strokeWidth must be a non-negative integer')
    expect(errorsFor({ strokeMiterLimit: 0 })).toContain('layouts.lyt_1.defaults.title.strokeMiterLimit must be a positive number')
  })

  it('rejects an adjust value missing its name or formula', () => {
    expect(errorsFor({ adjustValues: [{ formula: 'val 1' }] }))
      .toContain('layouts.lyt_1.defaults.title.adjustValues[0].name must be a non-empty string')
    expect(errorsFor({ adjustValues: [{ name: 'adj' }] }))
      .toContain('layouts.lyt_1.defaults.title.adjustValues[0].formula must be a non-empty string')
  })

  it('runs the fill rules over the default fill and stroke', () => {
    expect(errorsFor({ fill: { color: { type: 'srgb', v: 'not-a-colour' } } })
      .some((error) => error.startsWith('layouts.lyt_1.defaults.title.fill'))).toBe(true)
    expect(errorsFor({ stroke: 'navy' })).toContain('layouts.lyt_1.defaults.title.stroke must be an object')
  })

  it('runs the shadow, geometry and style rules', () => {
    expect(errorsFor({ shadow: { color: { type: 'srgb', v: '000000' }, blurRadius: -1 } })
      .some((error) => error.startsWith('layouts.lyt_1.defaults.title.shadow'))).toBe(true)
    expect(errorsFor({ customGeometry: { paths: 'nope' } })
      .some((error) => error.startsWith('layouts.lyt_1.defaults.title.customGeometry'))).toBe(true)
    expect(errorsFor({ styleRef: { fill: { idx: -1 } } })
      .some((error) => error.startsWith('layouts.lyt_1.defaults.title.styleRef'))).toBe(true)
  })

  /** The master's defaults go through the same call, so the path is the only difference. */
  it('validates a master default the same way', () => {
    const document = {
      format: 'ppt4ai',
      version: 1,
      id: 'dck_validate',
      page: { w: 12192000, h: 6858000 },
      slides: { sld_1: { id: 'sld_1', elementIds: [] } },
      slideOrder: ['sld_1'],
      elements: {},
      masters: { mst_1: { id: 'mst_1', defaults: { title: { strokeCap: 'blunt' } } } },
    } as unknown as Ppt4aiDocument
    const result = validateDocument(document)

    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.errors).toContain('masters.mst_1.defaults.title.strokeCap must be flat, rnd, or sq')
  })
})

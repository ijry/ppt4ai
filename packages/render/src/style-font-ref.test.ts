import { describe, expect, it } from 'vitest'
import type { Element, Ppt4aiDocument, ShapeStyleReference, Theme } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

const theme: Theme = {
  id: 'theme-1',
  colors: { lt1: { type: 'srgb', v: 'FFFFFF' }, dk1: { type: 'srgb', v: '000000' }, accent1: { type: 'srgb', v: '4472C4' } },
  fonts: { major: { latin: 'Cambria' }, minor: { latin: 'Calibri' } },
  formatScheme: { fillStyles: [{ color: { type: 'scheme', v: 'phClr' } }] },
}

const bounds = { x: 0, y: 0, w: 2000000, h: 1000000 }

/** The stock shape-gallery shape: accent fill from `fillRef`, white text only from `fontRef`. */
const galleryStyle: ShapeStyleReference = {
  fill: { idx: 1, color: { type: 'scheme', v: 'accent1' } },
  font: { idx: 'minor', color: { type: 'scheme', v: 'lt1' } },
}

function documentWith(element: Extract<Element, { kind: 'text' }>): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_font_ref',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [element.id], layoutId: 'lyt_1' } },
    slideOrder: ['sld_1'],
    elements: { [element.id]: element },
    layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } },
    masters: { mst_1: { id: 'mst_1', themeId: 'theme-1' } },
    themes: { 'theme-1': theme },
  }
}

function firstRun(element: Extract<Element, { kind: 'text' }>) {
  const node = documentToSceneGraph(documentWith(element)).nodes[0]
  if (node?.kind !== 'text') throw new Error('fixture did not build a text node')
  const run = node.layout.lines[0]?.runs[0]
  if (!run) throw new Error('fixture produced no run')
  return run
}

function textElement(overrides: Partial<Extract<Element, { kind: 'text' }>> = {}): Extract<Element, { kind: 'text' }> {
  return {
    id: 'el_text',
    kind: 'text',
    bounds,
    body: { paragraphs: [{ runs: [{ text: 'Label' }] }] },
    ...overrides,
  }
}

describe('style matrix font reference in the scene graph', () => {
  /**
   * Before this the run had no resolved colour and paint fell back to black, so the gallery's white
   * text landed as black on a dark accent fill.
   */
  it('gives a run with no colour of its own the fontRef colour', () => {
    expect(firstRun(textElement({ styleRef: galleryStyle })).resolvedColor).toEqual({ rgb: 'FFFFFF', alpha: 100000 })
  })

  it('gives a run with no family of its own the fontRef typeface', () => {
    expect(firstRun(textElement({ styleRef: galleryStyle })).resolvedFontFamily).toBe('Calibri')
  })

  /** The run's own declaration is explicit, so it outranks the shape-level style matrix entry. */
  it('prefers the run colour over the fontRef colour', () => {
    const run = firstRun(textElement({
      styleRef: galleryStyle,
      body: { paragraphs: [{ runs: [{ text: 'Label', marks: { color: { color: { type: 'scheme', v: 'dk1' } } } }] }] },
    }))

    expect(run.resolvedColor).toEqual({ rgb: '000000', alpha: 100000 })
  })

  /**
   * The scene leaves `resolvedFontFamily` unset when it would just repeat `marks.fontFamily`, so the
   * contract here is that the fontRef family does not leak in — paint then uses the run's own.
   */
  it('does not let the fontRef collection override the run typeface', () => {
    const run = firstRun(textElement({
      styleRef: galleryStyle,
      body: { paragraphs: [{ runs: [{ text: 'Label', marks: { fontFamily: 'Georgia' } }] }] },
    }))

    expect(run).not.toHaveProperty('resolvedFontFamily')
    expect(run.marks?.fontFamily).toBe('Georgia')
  })

  /** A run family that is itself a theme reference still wins, resolved through the theme. */
  it('prefers a run theme reference over the fontRef collection', () => {
    const run = firstRun(textElement({
      styleRef: galleryStyle,
      body: { paragraphs: [{ runs: [{ text: 'Label', marks: { fontFamily: '+mj-lt' } }] }] },
    }))

    expect(run.resolvedFontFamily).toBe('Cambria')
  })

  it('carries nothing when the shape has no fontRef', () => {
    const run = firstRun(textElement({ styleRef: { fill: { idx: 1, color: { type: 'scheme', v: 'accent1' } } } }))

    expect(run).not.toHaveProperty('resolvedColor')
    expect(run).not.toHaveProperty('resolvedFontFamily')
  })

  it('carries no typeface when the fontRef collection is none', () => {
    const run = firstRun(textElement({ styleRef: { font: { idx: 'none', color: { type: 'scheme', v: 'lt1' } } } }))

    expect(run.resolvedColor).toEqual({ rgb: 'FFFFFF', alpha: 100000 })
    expect(run).not.toHaveProperty('resolvedFontFamily')
  })

  it('keeps the scene structured-clone safe', () => {
    const graph = documentToSceneGraph(documentWith(textElement({ styleRef: galleryStyle })))

    expect(structuredClone(graph)).toEqual(graph)
  })
})

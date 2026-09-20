import { describe, expect, it } from 'vitest'
import type { Fill, Ppt4aiDocument, Theme } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

const directPattern: Fill = {
  color: { type: 'srgb', v: '204060', transforms: [{ type: 'alpha', value: 50000 }] },
  pattern: { preset: 'pct50',
    foreground: { type: 'srgb', v: '204060', transforms: [{ type: 'alpha', value: 50000 }] },
    background: { type: 'srgb', v: 'FFFFFF', transforms: [{ type: 'alpha', value: 25000 }] },
  },
}
const theme: Theme = {
  id: 'theme', colors: { accent1: { type: 'srgb', v: '204060' }, accent2: { type: 'srgb', v: 'FFFFFF' }, accent3: { type: 'srgb', v: '00FF00' } },
  formatScheme: {
    fillStyles: [{ color: { type: 'srgb', v: 'FF0000' }, pattern: { preset: 'pct90', foreground: { type: 'srgb', v: 'FF0000' }, background: { type: 'srgb', v: '000000' } } }],
    lineStyles: [{ color: { type: 'scheme', v: 'phClr' }, width: 12700, style: 'dash', cap: 'rnd', join: 'bevel',
      pattern: { preset: 'pct50',
        foreground: { type: 'scheme', v: 'phClr', transforms: [{ type: 'alphaMod', value: 50000 }] },
        background: { type: 'scheme', v: 'accent2', transforms: [{ type: 'alpha', value: 60000 }] },
      },
    }, null, { color: { type: 'srgb', v: '000000' } }],
  },
}
const expectedThemePattern = {
  preset: 'pct50', foreground: { rgb: '204060', alpha: 40000 }, background: { rgb: 'FFFFFF', alpha: 60000 },
}

function documentWith(kind: 'shape' | 'text' = 'shape'): Ppt4aiDocument {
  const shared = { id: 'element', bounds: { x: 0, y: 0, w: 2000000, h: 1000000 },
    styleRef: { line: { idx: 1, color: { type: 'scheme' as const, v: 'accent1', transforms: [{ type: 'alpha', value: 80000 }] } } },
  }
  return {
    format: 'ppt4ai', version: 1, id: 'pattern-stroke', page: { w: 12192000, h: 6858000 },
    slides: { slide: { id: 'slide', elementIds: ['element'], layoutId: 'layout' } }, slideOrder: ['slide'],
    elements: { element: kind === 'shape' ? { ...shared, kind, preset: 'rect' }
      : { ...shared, kind, preset: 'rect', body: { paragraphs: [{ runs: [{ text: 'Label' }] }] } } },
    layouts: { layout: { id: 'layout', masterId: 'master' } }, masters: { master: { id: 'master', themeId: 'theme' } },
    themes: { theme: structuredClone(theme) },
  }
}
function elementOf(doc: Ppt4aiDocument) {
  const element = doc.elements.element
  if (element?.kind !== 'shape' && element?.kind !== 'text') throw new Error('fixture element missing')
  return element
}
function nodeOf(doc: Ppt4aiDocument) {
  const node = documentToSceneGraph(doc).nodes[0]
  if (node?.kind !== 'shape' && node?.kind !== 'text') throw new Error('fixture node missing')
  return node
}
function themeLine(doc: Ppt4aiDocument) { return doc.themes!.theme!.formatScheme!.lineStyles![0]! }

const gradient: NonNullable<Fill['gradient']> = {
  stops: [{ pos: 0, color: { type: 'srgb', v: '000000' } }, { pos: 100000, color: { type: 'srgb', v: 'FFFFFF' } }], angle: 0,
}

describe('direct and theme pattern strokes in the scene graph', () => {
  it.each(['shape', 'text'] as const)('resolves both direct pattern colors for a %s', (kind) => {
    const doc = documentWith(kind)
    elementOf(doc).stroke = structuredClone(directPattern)
    const node = nodeOf(doc)
    expect(node.resolvedStrokePattern).toEqual({ preset: 'pct50', foreground: { rgb: '204060', alpha: 50000 }, background: { rgb: 'FFFFFF', alpha: 25000 } })
    expect(node.resolvedStrokeColor).toEqual({ rgb: '204060', alpha: 50000 })
    expect(node.resolvedStrokeGradient).toBeUndefined()
  })

  it.each(['shape', 'text'] as const)('resolves lnRef pattern colors instead of the fillStyles entry for a %s', (kind) => {
    const node = nodeOf(documentWith(kind))
    expect(node.resolvedStrokePattern).toEqual(expectedThemePattern)
    expect(node.resolvedStrokeColor).toEqual({ rgb: '204060', alpha: 80000 })
    expect(node).toMatchObject({ strokeWidth: 12700, strokeStyle: 'dash', strokeCap: 'rnd', strokeJoin: 'bevel' })
  })

  it('applies placeholder transforms to both pattern slots in reference-then-entry order', () => {
    const doc = documentWith()
    elementOf(doc).styleRef!.line!.color!.transforms = [{ type: 'tint', value: 100000 }, { type: 'alpha', value: 80000 }]
    themeLine(doc).pattern!.foreground.transforms = [{ type: 'shade', value: 50000 }, { type: 'alphaMod', value: 50000 }]
    themeLine(doc).pattern!.background = { type: 'scheme', v: 'phClr', transforms: [{ type: 'alphaOff', value: 10000 }] }
    expect(nodeOf(doc).resolvedStrokePattern).toEqual({
      preset: 'pct50', foreground: { rgb: '808080', alpha: 40000 }, background: { rgb: 'FFFFFF', alpha: 90000 },
    })
  })

  it('uses the merged slide color map for the foreground and background', () => {
    const doc = documentWith()
    doc.masters!.master!.colorMap = { accent1: 'accent2' }
    doc.layouts!.layout!.colorMapOverride = { accent1: 'accent3' }
    doc.slides.slide!.colorMapOverride = { accent2: 'accent3' }
    expect(nodeOf(doc).resolvedStrokePattern).toEqual({
      preset: 'pct50', foreground: { rgb: '00FF00', alpha: 40000 }, background: { rgb: '00FF00', alpha: 60000 },
    })
  })

  it('continues to inherit the pattern when only width or dash is overridden', () => {
    const doc = documentWith()
    Object.assign(elementOf(doc), { strokeWidth: 38100, strokeStyle: 'dot' })
    expect(nodeOf(doc)).toMatchObject({ resolvedStrokePattern: expectedThemePattern, strokeWidth: 38100, strokeStyle: 'dot' })
  })

  it('keeps a direct pattern even when the theme line supplies a gradient', () => {
    const doc = documentWith()
    themeLine(doc).gradient = structuredClone(gradient)
    elementOf(doc).stroke = structuredClone(directPattern)
    const node = nodeOf(doc)
    expect(node.resolvedStrokePattern?.foreground).toEqual({ rgb: '204060', alpha: 50000 })
    expect(node.resolvedStrokeGradient).toBeUndefined()
  })

  it.each(['shape', 'text'] as const)('does not apply a theme pattern to a direct solid %s stroke', (kind) => {
    const doc = documentWith(kind)
    elementOf(doc).stroke = { color: { type: 'srgb', v: '00FF00' } }
    expect(nodeOf(doc).resolvedStrokePattern).toBeUndefined()
    expect(nodeOf(doc).resolvedStrokeColor?.rgb).toBe('00FF00')
  })

  it('honors a direct gradient instead of the theme pattern', () => {
    const doc = documentWith()
    elementOf(doc).stroke = { color: { type: 'srgb', v: '000000' }, gradient: structuredClone(gradient) }
    expect(nodeOf(doc).resolvedStrokePattern).toBeUndefined()
    expect(nodeOf(doc).resolvedStrokeGradient?.stops).toHaveLength(2)
  })

  it('does not fall back to the theme when a direct pattern color is unresolved', () => {
    const doc = documentWith()
    const fill = structuredClone(directPattern)
    fill.pattern!.background = { type: 'scheme', v: 'missing' }
    elementOf(doc).stroke = fill
    expect(nodeOf(doc).resolvedStrokePattern).toBeUndefined()
    expect(nodeOf(doc).resolvedStrokeColor).toEqual({ rgb: '204060', alpha: 50000 })
  })

  it('honors a layout-inherited solid stroke ahead of the theme pattern', () => {
    const doc = documentWith('text')
    elementOf(doc).placeholder = 'title'
    doc.layouts!.layout!.defaults = { title: { stroke: { color: { type: 'srgb', v: '00FF00' } } } }
    expect(nodeOf(doc).resolvedStrokePattern).toBeUndefined()
    expect(nodeOf(doc).resolvedStrokeColor?.rgb).toBe('00FF00')
  })

  it.each(['direct', 'theme'] as const)('respects gradient precedence when a %s fill carries both forms', (location) => {
    const doc = documentWith()
    if (location === 'direct') elementOf(doc).stroke = { ...structuredClone(directPattern), gradient: structuredClone(gradient) }
    else themeLine(doc).gradient = structuredClone(gradient)
    expect(nodeOf(doc).resolvedStrokePattern).toBeUndefined()
    expect(nodeOf(doc).resolvedStrokeGradient?.stops).toHaveLength(2)
  })

  it.each([0, 2, 3, 99])('resolves no pattern for index %s', (idx) => {
    const doc = documentWith()
    elementOf(doc).styleRef!.line!.idx = idx
    expect(nodeOf(doc).resolvedStrokePattern).toBeUndefined()
  })

  it('keeps the foreground fallback if a theme background cannot resolve', () => {
    const doc = documentWith()
    themeLine(doc).pattern!.background = { type: 'scheme', v: 'missing' }
    expect(nodeOf(doc).resolvedStrokePattern).toBeUndefined()
    expect(nodeOf(doc).resolvedStrokeColor?.rgb).toBe('204060')
  })

  it('keeps unsupported preset words for the painter to fall back without inventing a texture', () => {
    const doc = documentWith()
    themeLine(doc).pattern!.preset = 'weave'
    expect(nodeOf(doc).resolvedStrokePattern?.preset).toBe('weave')
  })

  it('follows theme edits without mutating or pinning the original stroke', () => {
    const doc = documentWith()
    const before = structuredClone(doc)
    const first = nodeOf(doc)
    expect(first.resolvedStrokePattern).toEqual(expectedThemePattern)
    expect(doc).toEqual(before)
    doc.themes!.theme!.colors.accent1 = { type: 'srgb', v: 'FF0000' }
    const second = nodeOf(doc)
    expect(second.resolvedStrokePattern?.foreground.rgb).toBe('FF0000')
    expect(elementOf(doc).stroke).toBeUndefined()
    expect(elementOf(doc).styleRef).toEqual(elementOf(before).styleRef)
    expect(structuredClone(second)).toEqual(second)
  })
})

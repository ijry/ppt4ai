import { describe, expect, it } from 'vitest'
import type { Element, Fill, Ppt4aiDocument, Theme } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

const bounds = { x: 0, y: 0, w: 2000000, h: 1000000 }
const theme: Theme = {
  id: 'theme-1',
  colors: {
    accent1: { type: 'srgb', v: '204060' }, accent2: { type: 'srgb', v: '80A0C0' },
    accent3: { type: 'srgb', v: 'FF0000' }, accent4: { type: 'srgb', v: 'FFFFFF' },
  },
  formatScheme: {
    // The same numeric index in fillStyles must not be mistaken for the line entry.
    fillStyles: [{ color: { type: 'srgb', v: 'FF0000' }, gradient: {
      stops: [{ pos: 0, color: { type: 'srgb', v: 'FF0000' } }, { pos: 100000, color: { type: 'srgb', v: '000000' } }],
    } }],
    lineStyles: [
      {
        color: { type: 'scheme', v: 'phClr' },
        gradient: {
          stops: [
            { pos: 0, color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'alphaMod', value: 50000 }] } },
            { pos: 100000, color: { type: 'scheme', v: 'accent2', transforms: [{ type: 'alpha', value: 30000 }] } },
          ],
          angle: 5400000, scaled: true,
        },
        width: 12700, style: 'dash', cap: 'rnd', join: 'bevel',
      },
      null,
      { color: { type: 'scheme', v: 'phClr' }, width: 6350 },
    ],
  },
}
const expectedRamp = {
  stops: [{ pos: 0, color: { rgb: '204060', alpha: 40000 } }, { pos: 100000, color: { rgb: '80A0C0', alpha: 30000 } }],
  angle: 5400000, scaled: true,
}

function documentWith(kind: 'shape' | 'text' = 'shape'): Ppt4aiDocument {
  const shared = { id: 'element', bounds, styleRef: { line: { idx: 1, color: { type: 'scheme' as const, v: 'accent1', transforms: [{ type: 'alpha', value: 80000 }] } } } }
  const element: Element = kind === 'shape' ? { ...shared, kind, preset: 'rect' }
    : { ...shared, kind, preset: 'rect', body: { paragraphs: [{ runs: [{ text: 'Label' }] }] } }
  return {
    format: 'ppt4ai', version: 1, id: 'theme-gradient-stroke', page: { w: 12192000, h: 6858000 },
    slides: { slide: { id: 'slide', elementIds: ['element'], layoutId: 'layout' } }, slideOrder: ['slide'],
    elements: { element }, layouts: { layout: { id: 'layout', masterId: 'master' } },
    masters: { master: { id: 'master', themeId: 'theme-1' } }, themes: { 'theme-1': structuredClone(theme) },
  }
}

function elementOf(doc: Ppt4aiDocument) {
  const element = doc.elements.element
  if (element?.kind !== 'shape' && element?.kind !== 'text') throw new Error('fixture element missing')
  return element
}
function nodeOf(doc: Ppt4aiDocument) {
  const node = documentToSceneGraph(doc).nodes[0]
  if (node?.kind !== 'shape' && node?.kind !== 'text') throw new Error('scene element missing')
  return node
}
function rampOf(doc: Ppt4aiDocument) {
  return doc.themes!['theme-1']!.formatScheme!.lineStyles![0]!.gradient!
}

describe('theme gradient strokes in the scene graph', () => {
  it.each(['shape', 'text'] as const)('resolves the lnRef ramp, not fillRef, for a %s', (kind) => {
    const node = nodeOf(documentWith(kind))
    expect(node.resolvedStrokeGradient).toEqual(expectedRamp)
    expect(node.resolvedStrokeColor).toEqual({ rgb: '204060', alpha: 80000 })
    expect(node).toMatchObject({ strokeWidth: 12700, strokeStyle: 'dash', strokeCap: 'rnd', strokeJoin: 'bevel' })
    expect(node.path!.length).toBeGreaterThan(0)
  })

  it('applies reference transforms before stop transforms without changing non-placeholder stops', () => {
    const doc = documentWith()
    elementOf(doc).styleRef!.line!.color!.transforms = [{ type: 'tint', value: 100000 }, { type: 'alpha', value: 80000 }]
    rampOf(doc).stops[0]!.color.transforms = [{ type: 'shade', value: 50000 }, { type: 'alphaMod', value: 50000 }]
    expect(nodeOf(doc).resolvedStrokeGradient?.stops).toEqual([
      { pos: 0, color: { rgb: '808080', alpha: 40000 } },
      { pos: 100000, color: { rgb: '80A0C0', alpha: 30000 } },
    ])
  })

  it('uses the merged master, layout and slide color map for placeholder stops', () => {
    const doc = documentWith()
    doc.masters!.master!.colorMap = { accent1: 'accent2' }
    doc.layouts!.layout!.colorMapOverride = { accent1: 'accent3' }
    doc.slides.slide!.colorMapOverride = { accent1: 'accent4' }
    expect(nodeOf(doc).resolvedStrokeGradient?.stops[0]?.color).toEqual({ rgb: 'FFFFFF', alpha: 40000 })
    delete doc.slides.slide!.colorMapOverride
    expect(nodeOf(doc).resolvedStrokeGradient?.stops[0]?.color.rgb).toBe('FF0000')
    delete doc.layouts!.layout!.colorMapOverride
    expect(nodeOf(doc).resolvedStrokeGradient?.stops[0]?.color.rgb).toBe('80A0C0')
  })

  it('inherits the gradient when only line width, dash or cap is set directly', () => {
    const doc = documentWith()
    Object.assign(elementOf(doc), { strokeWidth: 38100, strokeStyle: 'dot', strokeCap: 'sq' })
    expect(nodeOf(doc)).toMatchObject({ resolvedStrokeGradient: expectedRamp, strokeWidth: 38100, strokeStyle: 'dot', strokeCap: 'sq' })
  })

  // A fallback based on resolvedFillGradient(...) ?? themeRamp would incorrectly resurrect the ramp.
  it.each(['shape', 'text'] as const)('does not cover a direct solid stroke with the theme gradient on a %s', (kind) => {
    const doc = documentWith(kind)
    elementOf(doc).stroke = { color: { type: 'srgb', v: '00FF00' } }
    expect(nodeOf(doc).resolvedStrokeGradient).toBeUndefined()
    expect(nodeOf(doc).resolvedStrokeColor).toEqual({ rgb: '00FF00', alpha: 100000 })
    expect(nodeOf(doc).strokeWidth).toBe(12700)
  })

  it('prefers a directly supplied gradient to the theme entry', () => {
    const doc = documentWith()
    elementOf(doc).stroke = { color: { type: 'srgb', v: '000000' }, gradient: {
      stops: [{ pos: 0, color: { type: 'srgb', v: '000000' } }, { pos: 100000, color: { type: 'srgb', v: 'FFFFFF' } }], angle: 0,
    } }
    expect(nodeOf(doc).resolvedStrokeGradient).toEqual({
      stops: [{ pos: 0, color: { rgb: '000000', alpha: 100000 } }, { pos: 100000, color: { rgb: 'FFFFFF', alpha: 100000 } }], angle: 0,
    })
  })

  it('does not use the theme ramp when a direct gradient has fewer than two resolvable stops', () => {
    const doc = documentWith()
    elementOf(doc).stroke = { color: { type: 'srgb', v: '00FF00' }, gradient: {
      stops: [{ pos: 0, color: { type: 'srgb', v: '00FF00' } }, { pos: 100000, color: { type: 'scheme', v: 'missing' } }],
    } }
    expect(nodeOf(doc).resolvedStrokeGradient).toBeUndefined()
    expect(nodeOf(doc).resolvedStrokeColor?.rgb).toBe('00FF00')
  })

  it('does not add a theme gradient behind a direct pattern stroke', () => {
    const doc = documentWith()
    const fill: Fill = { color: { type: 'srgb', v: '00FF00' }, pattern: {
      preset: 'pct10', foreground: { type: 'srgb', v: '00FF00' }, background: { type: 'srgb', v: 'FFFFFF' },
    } }
    elementOf(doc).stroke = fill
    expect(nodeOf(doc).resolvedStrokeGradient).toBeUndefined()
    expect(nodeOf(doc).resolvedStrokeColor?.rgb).toBe('00FF00')
  })

  it('honors a solid outline inherited from the layout before the theme line fill', () => {
    const doc = documentWith('text')
    elementOf(doc).placeholder = 'title'
    doc.layouts!.layout!.defaults = { title: { stroke: { color: { type: 'srgb', v: '00FF00' } } } }
    expect(nodeOf(doc).resolvedStrokeGradient).toBeUndefined()
    expect(nodeOf(doc).resolvedStrokeColor?.rgb).toBe('00FF00')
  })

  it.each([0, 2, 3, 99])('produces no gradient for none, null, solid or missing line index %s', (idx) => {
    const doc = documentWith()
    elementOf(doc).styleRef!.line!.idx = idx
    expect(nodeOf(doc).resolvedStrokeGradient).toBeUndefined()
  })

  it('drops unresolved stops without moving the surviving stop positions', () => {
    const doc = documentWith()
    rampOf(doc).stops.splice(1, 0, { pos: 25000, color: { type: 'scheme', v: 'missing' } })
    expect(nodeOf(doc).resolvedStrokeGradient).toEqual(expectedRamp)
  })

  it('keeps a flat fallback when fewer than two theme stops resolve', () => {
    const doc = documentWith()
    rampOf(doc).stops[1]!.color = { type: 'scheme', v: 'missing' }
    expect(nodeOf(doc).resolvedStrokeGradient).toBeUndefined()
    expect(nodeOf(doc).resolvedStrokeColor?.rgb).toBe('204060')
  })

  it('resolves non-placeholder stops even when lnRef supplies no color', () => {
    const doc = documentWith()
    delete elementOf(doc).styleRef!.line!.color
    rampOf(doc).stops[0]!.color = { type: 'srgb', v: '000000' }
    rampOf(doc).stops[1]!.color = { type: 'srgb', v: 'FFFFFF' }
    doc.themes!['theme-1']!.formatScheme!.lineStyles![0]!.color = { type: 'srgb', v: '000000' }
    expect(nodeOf(doc).resolvedStrokeGradient?.stops).toEqual([
      { pos: 0, color: { rgb: '000000', alpha: 100000 } }, { pos: 100000, color: { rgb: 'FFFFFF', alpha: 100000 } },
    ])
  })

  it('passes radial geometry through without aliasing the model fillToRect', () => {
    const doc = documentWith()
    const ramp = rampOf(doc)
    delete ramp.angle
    delete ramp.scaled
    ramp.path = 'rect'
    ramp.fillToRect = { left: 20000, top: 40000, right: 60000, bottom: 40000 }
    const node = nodeOf(doc)
    expect(node.resolvedStrokeGradient).toEqual({ stops: expectedRamp.stops, path: 'rect', fillToRect: ramp.fillToRect })
    node.resolvedStrokeGradient!.fillToRect!.left = 99999
    expect(ramp.fillToRect.left).toBe(20000)
  })

  it('follows theme color changes without pinning the reference or mutating the input model', () => {
    const doc = documentWith()
    const before = structuredClone(doc)
    const first = nodeOf(doc)
    expect(doc).toEqual(before)
    expect(first.resolvedStrokeGradient).toEqual(expectedRamp)
    doc.themes!['theme-1']!.colors.accent1 = { type: 'srgb', v: 'FFFFFF' }
    const second = nodeOf(doc)
    expect(second.resolvedStrokeGradient?.stops[0]?.color.rgb).toBe('FFFFFF')
    expect(elementOf(doc).stroke).toBeUndefined()
    expect(elementOf(doc).styleRef).toEqual(elementOf(before).styleRef)
    expect(structuredClone(second)).toEqual(second)
  })
})

import type { Color, Ppt4aiDocument, ResolvedColor } from '@ppt4ai/model'
import { documentToSceneGraph } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { paintShapeNode } from './shape-painting'
import { paintTextNode } from './text-painting'

interface PaintEvent {
  style: unknown
  alpha: number
  shadow: string
  width: number
  cap: string
  join: string
  miter: number
}

/** Record the actual painter's calls, including shadows and geometry; no precomputed scene colors. */
class RecordingContext {
  readonly strokes: PaintEvent[] = []
  readonly fills: Array<{ style: unknown; alpha: number; shadow: string }> = []
  readonly dashes: number[][] = []
  readonly paths: Array<[string, ...number[]]> = []
  readonly states: Array<Record<string, unknown>> = []
  fillStyle: unknown = ''
  strokeStyle: unknown = ''
  globalAlpha = 1
  lineWidth = 1
  lineCap = 'butt'
  lineJoin = 'miter'
  miterLimit = 10
  shadowColor = 'rgba(0, 0, 0, 0)'
  shadowBlur = 0
  shadowOffsetX = 0
  shadowOffsetY = 0
  clipCalls = 0
  fillRectCalls = 0
  save(): void {
    this.states.push(Object.fromEntries(['fillStyle', 'strokeStyle', 'globalAlpha', 'lineWidth', 'lineCap', 'lineJoin', 'miterLimit', 'shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY']
      .map((key) => [key, (this as unknown as Record<string, unknown>)[key]])))
  }
  restore(): void { Object.assign(this, this.states.pop()) }
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(x: number, y: number): void { this.paths.push(['moveTo', x, y]) }
  lineTo(x: number, y: number): void { this.paths.push(['lineTo', x, y]) }
  ellipse(): void {}
  fillText(): void {}
  clip(): void { this.clipCalls += 1 }
  fillRect(): void { this.fillRectCalls += 1 }
  setLineDash(pattern: number[]): void { this.dashes.push([...pattern]) }
  fill(): void { this.fills.push({ style: this.fillStyle, alpha: this.globalAlpha, shadow: this.shadowColor }) }
  stroke(): void {
    this.strokes.push({ style: this.strokeStyle, alpha: this.globalAlpha, shadow: this.shadowColor,
      width: this.lineWidth, cap: this.lineCap, join: this.lineJoin, miter: this.miterLimit })
  }
}

const black: ResolvedColor = { rgb: '000000', alpha: 100000 }
const white: ResolvedColor = { rgb: 'FFFFFF', alpha: 100000 }
function color(value: ResolvedColor): Color {
  return { type: 'srgb', v: value.rgb, ...(value.alpha === 100000 ? {} : { transforms: [{ type: 'alpha', value: value.alpha }] }) }
}
function documentWith(
  kind: 'shape' | 'text' = 'shape', origin: 'direct' | 'theme' = 'direct', preset = 'pct50',
  foreground = black, background = white,
): Ppt4aiDocument {
  const pattern = { preset, foreground: color(foreground), background: color(background) }
  const shared = { id: 'element', bounds: { x: 0, y: 0, w: 200, h: 100 }, strokeWidth: 10,
    strokeStyle: 'dash' as const, strokeCap: 'sq' as const, strokeJoin: 'miter' as const, strokeMiterLimit: 200000,
    ...(origin === 'direct' ? { stroke: { color: color(foreground), pattern } } : {}),
    styleRef: { line: { idx: 1, color: color(foreground) } },
  }
  return {
    format: 'ppt4ai', version: 1, id: 'percentage-stroke', page: { w: 200, h: 100 },
    slides: { slide: { id: 'slide', elementIds: ['element'], layoutId: 'layout' } }, slideOrder: ['slide'],
    elements: { element: kind === 'shape' ? { ...shared, kind, preset: 'rect' }
      : { ...shared, kind, preset: 'rect', body: { paragraphs: [{ runs: [] }] } } },
    layouts: { layout: { id: 'layout', masterId: 'master' } }, masters: { master: { id: 'master', themeId: 'theme' } },
    themes: { theme: { id: 'theme', colors: {}, formatScheme: { lineStyles: [{
      color: { type: 'scheme', v: 'phClr' },
      pattern: { ...pattern, foreground: { type: 'scheme', v: 'phClr' } }, width: 12700,
    }] } } },
  }
}
function elementOf(doc: Ppt4aiDocument) {
  const element = doc.elements.element
  if (element?.kind !== 'shape' && element?.kind !== 'text') throw new Error('fixture element missing')
  return element
}
function draw(doc: Ppt4aiDocument, mapping = { scale: 1, offsetX: 0, offsetY: 0 }): RecordingContext {
  const node = documentToSceneGraph(doc).nodes[0]
  const drawing = new RecordingContext()
  const context = drawing as unknown as CanvasRenderingContext2D
  if (node?.kind === 'shape') paintShapeNode(context, node, mapping)
  else if (node?.kind === 'text') paintTextNode(context, node, mapping)
  else throw new Error('fixture scene missing')
  return drawing
}

describe('percentage pattern strokes use one composite paint', () => {
  it.each([
    { kind: 'shape', origin: 'direct' }, { kind: 'text', origin: 'direct' },
    { kind: 'shape', origin: 'theme' }, { kind: 'text', origin: 'theme' },
  ] as const)('paints a $kind $origin pct50 outline with both colors, without filling the shape', ({ kind, origin }) => {
    const drawing = draw(documentWith(kind, origin))
    expect(drawing.strokes).toHaveLength(1)
    expect(drawing.strokes[0]).toMatchObject({ style: '#808080', alpha: 1, width: 10 })
    expect(drawing.fills).toEqual([])
    expect(drawing.fillRectCalls).toBe(0)
    expect(drawing.clipCalls).toBe(0)
  })

  it.each([
    { preset: 'pct5', style: '#F2F2F2' }, { preset: 'pct90', style: '#1A1A1A' }, { preset: 'pct100', style: '#000000' },
  ])('distinguishes $preset coverage rather than painting the foreground unconditionally', ({ preset, style }) => {
    const drawing = draw(documentWith('shape', 'theme', preset))
    expect(drawing.strokes).toHaveLength(1)
    expect(drawing.strokes[0]).toMatchObject({ style, alpha: 1 })
  })

  // Match the existing fill rule: foreground alpha * coverage over the background, premultiplied.
  // For half-red over half-blue at pct50: a=0.25, b=0.5*(1-0.25)=0.375, out=0.625, red=102 blue=153.
  it.each([
    { name: 'translucent foreground', foreground: { rgb: 'FF0000', alpha: 50000 }, background: { rgb: '00FF00', alpha: 100000 }, style: '#40BF00', alpha: 1 },
    { name: 'both translucent', foreground: { rgb: 'FF0000', alpha: 50000 }, background: { rgb: '0000FF', alpha: 50000 }, style: '#660099', alpha: 0.625 },
    { name: 'transparent background', foreground: { rgb: 'FF0000', alpha: 50000 }, background: { rgb: '0000FF', alpha: 0 }, style: '#FF0000', alpha: 0.25 },
    { name: 'transparent foreground', foreground: { rgb: 'FF0000', alpha: 0 }, background: { rgb: '0000FF', alpha: 50000 }, style: '#0000FF', alpha: 0.5 },
  ])('composites $name without multiplying alpha a second time', ({ foreground, background, style, alpha }) => {
    const drawing = draw(documentWith('shape', 'direct', 'pct50', foreground, background))
    expect(drawing.strokes).toHaveLength(1)
    expect(drawing.strokes[0]!.style).toBe(style)
    expect(drawing.strokes[0]!.alpha).toBeCloseTo(alpha)
  })

  it('handles two transparent colors without NaN or an opaque fallback', () => {
    const drawing = draw(documentWith('text', 'theme', 'pct50', { rgb: 'FF0000', alpha: 0 }, { rgb: '0000FF', alpha: 0 }))
    expect(drawing.strokes).toHaveLength(1)
    expect(drawing.strokes[0]!.style).toMatch(/^#[0-9A-F]{6}$/u)
    expect(drawing.strokes[0]!.alpha).toBe(0)
  })

  it('keeps dash, cap, join and miter settings at thumbnail scale', () => {
    const drawing = draw(documentWith(), { scale: 0.2, offsetX: 3, offsetY: 5 })
    expect(drawing.strokes).toHaveLength(1)
    expect(drawing.strokes[0]).toMatchObject({ style: '#808080', alpha: 1, width: 2, cap: 'square', join: 'miter', miter: 2 })
    expect(drawing.dashes).toContainEqual([8, 6])
    expect(drawing.paths).toContainEqual(['moveTo', 3, 5])
  })

  it('casts one shadow for a pattern outline rather than stroking twice', () => {
    const doc = documentWith('text', 'theme')
    elementOf(doc).shadow = { color: { type: 'srgb', v: '000000', transforms: [{ type: 'alpha', value: 50000 }] }, blurRadius: 5, distance: 4 }
    const drawing = draw(doc)
    expect(drawing.strokes).toHaveLength(1)
    expect(drawing.strokes[0]).toMatchObject({ style: '#808080', alpha: 1, shadow: 'rgba(0, 0, 0, 0.5)' })
    expect(drawing.fills).toHaveLength(0)
  })

  it('does not cast a second shadow after a filled shape has already cast it', () => {
    const doc = documentWith()
    elementOf(doc).fill = { color: { type: 'srgb', v: 'FFFF00' } }
    elementOf(doc).shadow = { color: { type: 'srgb', v: '000000' }, blurRadius: 5 }
    const drawing = draw(doc)
    expect(drawing.fills).toEqual([{ style: '#FFFF00', alpha: 1, shadow: 'rgba(0, 0, 0, 1)' }])
    expect(drawing.strokes).toHaveLength(1)
    expect(drawing.strokes[0]).toMatchObject({ style: '#808080', shadow: 'rgba(0, 0, 0, 0)' })
  })

  it.each(['ltHorz', 'weave', 'pct0', 'pct101'])('keeps the existing foreground fallback for unsupported %s', (preset) => {
    const drawing = draw(documentWith('shape', 'theme', preset, { rgb: '204060', alpha: 60000 }, white))
    expect(drawing.strokes).toHaveLength(1)
    expect(drawing.strokes[0]).toMatchObject({ style: '#204060', alpha: 0.6 })
    expect(drawing.clipCalls).toBe(0)
    expect(drawing.fillRectCalls).toBe(0)
  })

  it('keeps a direct solid outline ahead of the themed percentage pattern', () => {
    const doc = documentWith('shape', 'theme')
    elementOf(doc).stroke = { color: { type: 'srgb', v: '00FF00' } }
    const drawing = draw(doc)
    expect(drawing.strokes).toHaveLength(1)
    expect(drawing.strokes[0]).toMatchObject({ style: '#00FF00', alpha: 1 })
  })

  it('does not store the blended color back into the document', () => {
    const doc = documentWith('shape', 'theme')
    const before = structuredClone(doc)
    const drawing = draw(doc)
    expect(drawing.strokes[0]!.style).toBe('#808080')
    expect(doc).toEqual(before)
    expect(elementOf(doc).stroke).toBeUndefined()
  })
})

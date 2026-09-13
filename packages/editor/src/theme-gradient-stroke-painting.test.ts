import type { Ppt4aiDocument } from '@ppt4ai/model'
import { documentToSceneGraph } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { paintShapeNode } from './shape-painting'
import { paintTextNode } from './text-painting'

class RecordingGradient {
  readonly stops: Array<[number, string]> = []
  constructor(readonly kind: 'linear' | 'radial', readonly geometry: number[]) {}
  addColorStop(offset: number, color: string): void { this.stops.push([offset, color]) }
}

/** Record the Canvas API boundary; resolution and both production painters run unchanged. */
class RecordingContext {
  readonly gradients: RecordingGradient[] = []
  readonly strokes: Array<{ paint: unknown; alpha: number; width: number }> = []
  readonly dashes: number[][] = []
  fillStyle: unknown = ''
  strokeStyle: unknown = ''
  globalAlpha = 1
  lineWidth = 1
  save(): void {}
  restore(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  ellipse(): void {}
  closePath(): void {}
  fill(): void {}
  fillText(): void {}
  setLineDash(pattern: number[]): void { this.dashes.push(pattern) }
  createLinearGradient(...geometry: number[]): RecordingGradient {
    const gradient = new RecordingGradient('linear', geometry)
    this.gradients.push(gradient)
    return gradient
  }
  createRadialGradient(...geometry: number[]): RecordingGradient {
    const gradient = new RecordingGradient('radial', geometry)
    this.gradients.push(gradient)
    return gradient
  }
  stroke(): void { this.strokes.push({ paint: this.strokeStyle, alpha: this.globalAlpha, width: this.lineWidth }) }
}

function documentWith(kind: 'shape' | 'text' = 'shape'): Ppt4aiDocument {
  const shared = { id: 'element', bounds: { x: 0, y: 0, w: 200, h: 100 },
    styleRef: { line: { idx: 1, color: { type: 'scheme' as const, v: 'accent1' } } },
  }
  return {
    format: 'ppt4ai', version: 1, id: 'theme-gradient-canvas', page: { w: 200, h: 100 },
    slides: { slide: { id: 'slide', elementIds: ['element'], layoutId: 'layout' } }, slideOrder: ['slide'],
    elements: { element: kind === 'shape' ? { ...shared, kind, preset: 'rect' }
      : { ...shared, kind, preset: 'rect', body: { paragraphs: [{ runs: [] }] } } },
    layouts: { layout: { id: 'layout', masterId: 'master' } }, masters: { master: { id: 'master', themeId: 'theme' } },
    themes: { theme: { id: 'theme', colors: { accent1: { type: 'srgb', v: '4472C4' }, accent2: { type: 'srgb', v: 'ED7D31' } },
      formatScheme: { lineStyles: [{ color: { type: 'scheme', v: 'phClr' }, width: 10, style: 'dash',
        gradient: { stops: [
          { pos: 0, color: { type: 'scheme', v: 'phClr' } },
          { pos: 100000, color: { type: 'scheme', v: 'accent2', transforms: [{ type: 'alpha', value: 50000 }] } },
        ], angle: 0 },
      }] },
    } },
  }
}

function draw(doc: Ppt4aiDocument, mapping = { scale: 1, offsetX: 0, offsetY: 0 }): RecordingContext {
  const node = documentToSceneGraph(doc).nodes[0]
  const context = new RecordingContext()
  const canvas = context as unknown as CanvasRenderingContext2D
  if (node?.kind === 'shape') paintShapeNode(canvas, node, mapping)
  else if (node?.kind === 'text') paintTextNode(canvas, node, mapping)
  else throw new Error('fixture scene missing')
  return context
}

describe('theme line gradients reach the Canvas painters', () => {
  it.each(['shape', 'text'] as const)('paints a %s lnRef with the resolved gradient and per-stop alpha', (kind) => {
    const drawing = draw(documentWith(kind))
    expect(drawing.gradients).toHaveLength(1)
    const gradient = drawing.gradients[0]!
    expect(gradient.kind).toBe('linear')
    expect(gradient.geometry).toEqual([0, 50, 200, 50])
    expect(gradient.stops).toEqual([[0, '#4472C4'], [1, 'rgba(237, 125, 49, 0.5)']])
    expect(drawing.strokes).toEqual([{ paint: gradient, alpha: 1, width: 10 }])
    expect(drawing.dashes).toContainEqual([40, 30])
  })

  it('uses the mapped box and stroke width at thumbnail scale', () => {
    const drawing = draw(documentWith(), { scale: 0.2, offsetX: 3, offsetY: 5 })
    expect(drawing.gradients).toHaveLength(1)
    expect(drawing.gradients[0]!.geometry).toEqual([3, 15, 43, 15])
    expect(drawing.strokes[0]).toEqual({ paint: drawing.gradients[0], alpha: 1, width: 2 })
    expect(drawing.dashes).toContainEqual([8, 6])
  })

  it('passes a theme radial gradient to the existing radial Canvas implementation', () => {
    const doc = documentWith()
    const gradient = doc.themes!.theme!.formatScheme!.lineStyles![0]!.gradient!
    delete gradient.angle
    gradient.path = 'circle'
    gradient.fillToRect = { left: 50000, top: 50000, right: 50000, bottom: 50000 }
    const drawing = draw(doc)
    expect(drawing.gradients).toHaveLength(1)
    expect(drawing.gradients[0]!.kind).toBe('radial')
    expect(drawing.gradients[0]!.geometry.slice(0, 5)).toEqual([100, 50, 0, 100, 50])
    expect(drawing.gradients[0]!.geometry[5]).toBeCloseTo(Math.hypot(100, 50))
    expect(drawing.strokes[0]!.paint).toBe(drawing.gradients[0])
  })

  it('paints a direct solid stroke without constructing the theme gradient', () => {
    const doc = documentWith()
    const element = doc.elements.element
    if (element?.kind !== 'shape') throw new Error('fixture shape missing')
    element.stroke = { color: { type: 'srgb', v: '00FF00' } }
    const drawing = draw(doc)
    expect(drawing.gradients).toHaveLength(0)
    expect(drawing.strokes).toEqual([{ paint: '#00FF00', alpha: 1, width: 10 }])
  })
})

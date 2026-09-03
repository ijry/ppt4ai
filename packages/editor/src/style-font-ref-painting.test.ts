import type { Element, Ppt4aiDocument, Theme } from '@ppt4ai/model'
import { documentToSceneGraph } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { paintTextNode } from './text-painting'

type Event = [string, ...unknown[]]

class RecordingContext {
  readonly events: Event[] = []
  font = ''
  textAlign: CanvasTextAlign = 'start'
  textBaseline: CanvasTextBaseline = 'alphabetic'
  fillStyle = ''
  strokeStyle = ''
  globalAlpha = 1
  lineWidth = 1

  save(): void {}
  restore(): void {}
  fillText(text: string, x: number, y: number): void {
    this.events.push(['fillText', text, x, y, { font: this.font, fillStyle: this.fillStyle }])
  }
  beginPath(): void {}
  closePath(): void {}
  setLineDash(): void {}
  fill(): void {}
  ellipse(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
}

const theme: Theme = {
  id: 'theme-1',
  colors: { lt1: { type: 'srgb', v: 'FFFFFF' }, accent1: { type: 'srgb', v: '4472C4' } },
  fonts: { minor: { latin: 'Calibri' } },
  formatScheme: { fillStyles: [{ color: { type: 'scheme', v: 'phClr' } }] },
}

/** Dark accent fill from `fillRef`, white text supplied only by `fontRef`. */
const galleryShape: Element = {
  id: 'el_text',
  kind: 'text',
  preset: 'rect',
  bounds: { x: 0, y: 0, w: 2000000, h: 1000000 },
  body: { paragraphs: [{ runs: [{ text: 'Label', marks: { fontSize: 18 } }] }] },
  styleRef: {
    fill: { idx: 1, color: { type: 'scheme', v: 'accent1' } },
    font: { idx: 'minor', color: { type: 'scheme', v: 'lt1' } },
  },
}

function document(element: Element): Ppt4aiDocument {
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

function paint(element: Element): RecordingContext {
  const context = new RecordingContext()
  const node = documentToSceneGraph(document(element)).nodes[0]
  if (node?.kind !== 'text') throw new Error('fixture did not build a text node')
  paintTextNode(context as unknown as CanvasRenderingContext2D, node, { scale: 0.001, offsetX: 0, offsetY: 0 })
  return context
}

describe('style matrix font reference reaches the canvas', () => {
  /**
   * The readability defect this closes: the gallery shape's text was painted `#000000` on a `4472C4`
   * fill, because the run had no colour of its own and paint falls back to black.
   */
  it('paints the fontRef colour instead of the black fallback', () => {
    const fill = paint(galleryShape).events.find(([type]) => type === 'fillText')

    expect((fill?.[4] as { fillStyle: string }).fillStyle).toBe('#FFFFFF')
  })

  it('paints with the fontRef typeface', () => {
    const fill = paint(galleryShape).events.find(([type]) => type === 'fillText')

    expect((fill?.[4] as { font: string }).font).toContain('Calibri')
  })

  it('still paints black when the shape has no fontRef', () => {
    const withoutFontRef = { ...galleryShape, styleRef: { fill: { idx: 1, color: { type: 'scheme' as const, v: 'accent1' } } } }
    const fill = paint(withoutFontRef).events.find(([type]) => type === 'fillText')

    expect((fill?.[4] as { fillStyle: string }).fillStyle).toBe('#000000')
  })
})

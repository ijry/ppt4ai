import type { AssetAdapter, AssetMetadata } from '@ppt4ai/model'
import type { SceneGraph, SceneShapeNode } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { paintShapeNode } from './shape-painting'
import { createSlideCanvasRenderer, type NodePaintOverride } from './slide-canvas-renderer'

type Event = [string, ...unknown[]]

/** A canvas stub that records the calls and the alpha in force when a paint lands. */
function recordingContext(): CanvasRenderingContext2D & { events: Event[]; canvas: HTMLCanvasElement } {
  const events: Event[] = []
  const canvas = { width: 0, height: 0, style: { width: '', height: '' } }
  const context = {
    canvas,
    events,
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    filter: 'none',
    save: () => events.push(['save']),
    restore: () => events.push(['restore']),
    beginPath: () => events.push(['beginPath']),
    closePath: () => events.push(['closePath']),
    moveTo: (...v: number[]) => events.push(['moveTo', ...v]),
    lineTo: (...v: number[]) => events.push(['lineTo', ...v]),
    ellipse: (...v: number[]) => events.push(['ellipse', ...v]),
    rect: (...v: number[]) => events.push(['rect', ...v]),
    roundRect: (...v: unknown[]) => events.push(['roundRect', ...v]),
    fill(): void { events.push(['fill', this.fillStyle, this.globalAlpha]) },
    stroke(): void { events.push(['stroke', this.strokeStyle, this.globalAlpha]) },
    clip: () => events.push(['clip']),
    fillText: (...v: unknown[]) => events.push(['fillText', ...v]),
    drawImage: (...v: unknown[]) => events.push(['drawImage', ...v]),
    translate: (...v: number[]) => events.push(['translate', ...v]),
    rotate: (...v: number[]) => events.push(['rotate', ...v]),
    scale: (...v: number[]) => events.push(['scale', ...v]),
    setLineDash: (...v: number[]) => events.push(['setLineDash', ...v]),
    clearRect: (...v: number[]) => events.push(['clearRect', ...v]),
    fillRect: (...v: number[]) => events.push(['fillRect', ...v]),
    setTransform: (...v: number[]) => events.push(['setTransform', ...v]),
  }
  return context as unknown as CanvasRenderingContext2D & { events: Event[]; canvas: HTMLCanvasElement }
}

class StubAdapter implements AssetAdapter {
  async get(): Promise<Uint8Array | undefined> { return undefined }
  async put(_id: string, _data: Uint8Array, _metadata: AssetMetadata): Promise<void> {}
}

function shapeNode(): SceneShapeNode {
  return {
    id: 'shape-1',
    kind: 'shape',
    bounds: { x: 0, y: 0, w: 400, h: 200 },
    path: [{ type: 'move', x: 0, y: 0 }, { type: 'line', x: 400, y: 0 }, { type: 'close' }],
    resolvedFillColor: { rgb: '336699', alpha: 100000 },
  }
}

describe('mapping base alpha', () => {
  it('multiplies a fill by the mapping alpha', () => {
    const context = recordingContext()
    paintShapeNode(context, shapeNode(), { scale: 1, offsetX: 0, offsetY: 0, alpha: 0.5 })
    expect(context.events).toContainEqual(['fill', '#336699', 0.5])
  })

  it('leaves the fill opaque when no alpha is given', () => {
    const context = recordingContext()
    paintShapeNode(context, shapeNode(), { scale: 1, offsetX: 0, offsetY: 0 })
    expect(context.events).toContainEqual(['fill', '#336699', 1])
  })
})

describe('render override wrapper', () => {
  const scene: SceneGraph = { slideId: 'sld_1', page: { w: 9144000, h: 6858000 }, nodes: [shapeNode()] }

  async function renderWith(overrides?: ReadonlyMap<string, NodePaintOverride>): Promise<Event[]> {
    const context = recordingContext()
    const renderer = createSlideCanvasRenderer({ adapter: new StubAdapter() })
    await renderer.render(scene, context, overrides ? { overrides } : {})
    return context.events
  }

  it('dims a node by the override opacity at paint time', async () => {
    const events = await renderWith(new Map([['shape-1', { opacity: 0.4 }]]))
    expect(events).toContainEqual(['fill', '#336699', expect.closeTo(0.4, 6)])
  })

  it('emits a scale and rotation transform about the node for a geometry override', async () => {
    const events = await renderWith(new Map([['shape-1', { scale: 2, rotationDeg: 90 }]]))
    expect(events.some(([type, x, y]) => type === 'scale' && x === 2 && y === 2)).toBe(true)
    expect(events.some(([type, angle]) => type === 'rotate' && Math.abs((angle as number) - Math.PI / 2) < 1e-9)).toBe(true)
  })

  it('paints unchanged when there is no override for the node', async () => {
    const events = await renderWith(new Map([['other', { opacity: 0.1 }]]))
    expect(events).toContainEqual(['fill', '#336699', 1])
  })
})

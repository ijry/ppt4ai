import { describe, expect, it } from 'vitest'
import type { Ppt4aiDocument } from '@ppt4ai/model'
import { documentToSceneGraph, type SceneChartNode } from './index'

function documentWithChart(extra: Record<string, unknown> = {}): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_chart',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_chart'] } },
    slideOrder: ['sld_1'],
    elements: { el_chart: { id: 'el_chart', kind: 'chart', bounds: { x: 1, y: 2, w: 300, h: 400 }, chartRelId: 'rId2', ...extra } },
  } as unknown as Ppt4aiDocument
}

function chartNode(document: Ppt4aiDocument): SceneChartNode | undefined {
  return documentToSceneGraph(document).nodes.find((node): node is SceneChartNode => node.kind === 'chart')
}

describe('chart scene node', () => {
  it('produces a chart node carrying the frame bounds', () => {
    const node = chartNode(documentWithChart())
    expect(node).toBeDefined()
    expect(node?.bounds).toEqual({ x: 1, y: 2, w: 300, h: 400 })
  })

  it('carries rotation and flips as a transform', () => {
    expect(chartNode(documentWithChart({ rotation: 2700000, flipH: true }))?.transform).toEqual({ rotation: 2700000, flipH: true })
  })

  it('omits the transform when the frame is upright', () => {
    expect(chartNode(documentWithChart())?.transform).toBeUndefined()
  })
})

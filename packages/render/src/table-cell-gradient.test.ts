import { describe, expect, it } from 'vitest'
import type { Fill, Ppt4aiDocument } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

const gradient: Fill = {
  color: { type: 'srgb', v: '4472C4' },
  gradient: {
    stops: [
      { pos: 0, color: { type: 'srgb', v: '4472C4' } },
      { pos: 100000, color: { type: 'srgb', v: '203864' } },
    ],
    angle: 5400000,
  },
}

function tableDocument(cellFill: Fill): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_table_gradient',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_table'] } },
    slideOrder: ['sld_1'],
    elements: {
      el_table: {
        id: 'el_table',
        kind: 'table',
        bounds: { x: 0, y: 0, w: 4000000, h: 1000000 },
        columns: [4000000],
        rows: [{ height: 1000000, cells: [{ column: 0, body: { paragraphs: [{ runs: [] }] }, fill: cellFill }] }],
      },
    },
  }
}

function firstCell(document: Ppt4aiDocument) {
  const node = documentToSceneGraph(document).nodes[0]
  if (node?.kind !== 'table') throw new Error('fixture did not build a table node')
  return node.layout.cells[0]!
}

describe('table cell gradient fill in the scene graph', () => {
  it('resolves the stops alongside the flat fallback colour', () => {
    const cell = firstCell(tableDocument(gradient))

    expect(cell.resolvedFillColor).toEqual({ rgb: '4472C4', alpha: 100000 })
    expect(cell.resolvedFillGradient).toEqual({
      stops: [
        { pos: 0, color: { rgb: '4472C4', alpha: 100000 } },
        { pos: 100000, color: { rgb: '203864', alpha: 100000 } },
      ],
      angle: 5400000,
    })
  })

  it('carries no gradient for a plain solid cell fill', () => {
    const cell = firstCell(tableDocument({ color: { type: 'srgb', v: '1F3864' } }))
    expect(cell).not.toHaveProperty('resolvedFillGradient')
  })

  it('drops the gradient when fewer than two stops survive', () => {
    const cell = firstCell(tableDocument({
      color: { type: 'srgb', v: '4472C4' },
      gradient: { stops: [{ pos: 0, color: { type: 'srgb', v: '4472C4' } }] },
    }))
    expect(cell).not.toHaveProperty('resolvedFillGradient')
  })
})

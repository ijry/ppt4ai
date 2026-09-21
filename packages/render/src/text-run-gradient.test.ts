import { describe, expect, it } from 'vitest'
import type { Ppt4aiDocument, TextMarks } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

function documentWith(marks: TextMarks): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_text_gradient',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_text'], layoutId: 'lyt_1' } },
    slideOrder: ['sld_1'],
    elements: {
      el_text: {
        id: 'el_text',
        kind: 'text',
        bounds: { x: 0, y: 0, w: 4000000, h: 1000000 },
        body: { paragraphs: [{ runs: [{ text: 'Hi', marks }] }] },
      },
    },
    layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } },
    masters: { mst_1: { id: 'mst_1', themeId: 'theme-1' } },
    themes: { 'theme-1': { id: 'theme-1', colors: { accent1: { type: 'srgb', v: '204060' } } } },
  }
}

function firstRun(document: Ppt4aiDocument) {
  const node = documentToSceneGraph(document).nodes[0]
  if (node?.kind !== 'text') throw new Error('fixture did not build a text node')
  return node.layout.lines[0]!.runs[0]!
}

const gradient: TextMarks = {
  color: {
    color: { type: 'srgb', v: '4472C4' },
    gradient: {
      stops: [{ pos: 0, color: { type: 'srgb', v: '4472C4' } }, { pos: 100000, color: { type: 'srgb', v: '203864' } }],
      angle: 5400000,
    },
  },
}

describe('text run gradient in the scene graph', () => {
  it('resolves the run fill gradient alongside the flat colour', () => {
    const run = firstRun(documentWith(gradient))
    expect(run.resolvedColor).toEqual({ rgb: '4472C4', alpha: 100000 })
    expect(run.resolvedFillGradient).toEqual({
      stops: [
        { pos: 0, color: { rgb: '4472C4', alpha: 100000 } },
        { pos: 100000, color: { rgb: '203864', alpha: 100000 } },
      ],
      angle: 5400000,
    })
  })

  it('carries no gradient for a plain solid run colour', () => {
    expect(firstRun(documentWith({ color: { color: { type: 'srgb', v: 'FF0000' } } }))).not.toHaveProperty('resolvedFillGradient')
  })

  it('drops the gradient when fewer than two stops survive', () => {
    const run = firstRun(documentWith({ color: { color: { type: 'srgb', v: '4472C4' }, gradient: { stops: [{ pos: 0, color: { type: 'srgb', v: '4472C4' } }] } } }))
    expect(run).not.toHaveProperty('resolvedFillGradient')
  })
})

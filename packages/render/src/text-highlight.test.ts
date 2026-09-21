import { describe, expect, it } from 'vitest'
import type { Ppt4aiDocument, TextMarks } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

function documentWith(marks: TextMarks): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_highlight',
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

describe('text highlight in the scene graph', () => {
  it('resolves a direct highlight colour', () => {
    expect(firstRun(documentWith({ highlight: { type: 'srgb', v: 'FFFF00' } })).resolvedHighlight)
      .toEqual({ rgb: 'FFFF00', alpha: 100000 })
  })

  it('resolves a scheme highlight through the theme', () => {
    expect(firstRun(documentWith({ highlight: { type: 'scheme', v: 'accent1' } })).resolvedHighlight)
      .toEqual({ rgb: '204060', alpha: 100000 })
  })

  it('carries no highlight when the run has none', () => {
    expect(firstRun(documentWith({ color: { color: { type: 'srgb', v: 'FF0000' } } }))).not.toHaveProperty('resolvedHighlight')
  })
})

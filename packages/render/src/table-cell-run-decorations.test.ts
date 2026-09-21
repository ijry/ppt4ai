import { describe, expect, it } from 'vitest'
import type { Ppt4aiDocument, TextMarks } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

function tableDoc(marks: TextMarks): Ppt4aiDocument {
  return {
    format: 'ppt4ai', version: 1, id: 'd', page: { w: 12192000, h: 6858000 },
    slides: { s: { id: 's', elementIds: ['t'], layoutId: 'lyt_1' } }, slideOrder: ['s'],
    elements: {
      t: {
        id: 't', kind: 'table', bounds: { x: 0, y: 0, w: 4000000, h: 1000000 },
        columns: [4000000],
        rows: [{ height: 1000000, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'Hi', marks }] }] } }] }],
      },
    },
    layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } },
    masters: { mst_1: { id: 'mst_1', themeId: 'theme-1' } },
    themes: { 'theme-1': { id: 'theme-1', colors: { accent1: { type: 'srgb', v: '204060' } } } },
  }
}

function firstCellRun(document: Ppt4aiDocument) {
  const node = documentToSceneGraph(document).nodes[0]
  if (node?.kind !== 'table') throw new Error('not table')
  return node.layout.cells[0]!.textLayout.lines[0]!.runs[0]!
}

describe('table cell run text decorations resolve', () => {
  it('resolves a run highlight in a cell', () => {
    expect(firstCellRun(tableDoc({ highlight: { type: 'srgb', v: 'FFFF00' } })).resolvedHighlight).toEqual({ rgb: 'FFFF00', alpha: 100000 })
  })

  it('resolves a run gradient in a cell', () => {
    const run = firstCellRun(tableDoc({ color: { color: { type: 'srgb', v: '4472C4' }, gradient: { stops: [{ pos: 0, color: { type: 'srgb', v: '4472C4' } }, { pos: 100000, color: { type: 'srgb', v: '203864' } }] } } }))
    expect(run.resolvedFillGradient?.stops).toHaveLength(2)
  })

  it('resolves a run pattern in a cell', () => {
    const run = firstCellRun(tableDoc({ color: { color: { type: 'srgb', v: 'FF0000' }, pattern: { preset: 'pct50', foreground: { type: 'srgb', v: 'FF0000' }, background: { type: 'srgb', v: '000000' } } } }))
    expect(run.resolvedFillPattern?.preset).toBe('pct50')
  })
})

import { describe, expect, it } from 'vitest'
import type { Ppt4aiDocument, TextMarks } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

function documentWith(marks: TextMarks, themeFonts?: { latin?: string; ea?: string }): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_script',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_text'], layoutId: 'lyt_1' } },
    slideOrder: ['sld_1'],
    elements: {
      el_text: {
        id: 'el_text',
        kind: 'text',
        bounds: { x: 0, y: 0, w: 10000000, h: 2000000 },
        body: { paragraphs: [{ runs: [{ text: 'Hi 你好', marks }] }] },
      },
    },
    layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } },
    masters: { mst_1: { id: 'mst_1', themeId: 'theme-1' } },
    themes: {
      'theme-1': {
        id: 'theme-1',
        colors: {},
        ...(themeFonts ? { fonts: { minor: themeFonts } } : {}),
      },
    },
  }
}

function runsOf(document: Ppt4aiDocument) {
  const node = documentToSceneGraph(document).nodes[0]
  if (node?.kind !== 'text') throw new Error('fixture did not build a text node')
  return node.layout.lines.flatMap((line) => line.runs)
}

describe('per-script font resolution in the scene graph', () => {
  it('gives the east asian span the run east asian typeface', () => {
    const runs = runsOf(documentWith({ fontFamily: 'Calibri', fontFamilyEa: '宋体' }))

    expect(runs.map((run) => [run.text, run.resolvedFontFamily])).toEqual([
      ['Hi ', undefined],
      ['你好', '宋体'],
    ])
  })

  it('resolves a per-script theme reference through the theme font scheme', () => {
    const runs = runsOf(documentWith({ fontFamily: '+mn-lt', fontFamilyEa: '+mn-ea' }, { latin: 'Calibri', ea: '等线' }))

    expect(runs.map((run) => [run.text, run.resolvedFontFamily])).toEqual([
      ['Hi ', 'Calibri'],
      ['你好', '等线'],
    ])
  })

  /** Nothing to record when both slots name the same typeface: paint would read `marks.fontFamily` anyway. */
  it('omits the resolved family when the east asian typeface equals the latin one', () => {
    const runs = runsOf(documentWith({ fontFamily: 'Calibri', fontFamilyEa: 'Calibri' }))

    expect(runs).toHaveLength(2)
    expect(runs[0]).not.toHaveProperty('resolvedFontFamily')
    expect(runs[1]).not.toHaveProperty('resolvedFontFamily')
  })

  it('falls back to the latin typeface for an east asian span with no east asian slot', () => {
    const runs = runsOf(documentWith({ fontFamily: 'Calibri' }))

    expect(runs.map((run) => run.text)).toEqual(['Hi 你好'])
    expect(runs[0]).not.toHaveProperty('resolvedFontFamily')
  })

  it('keeps the scene structured-clone safe', () => {
    const graph = documentToSceneGraph(documentWith({ fontFamily: 'Calibri', fontFamilyEa: '宋体' }))

    expect(structuredClone(graph)).toEqual(graph)
  })
})

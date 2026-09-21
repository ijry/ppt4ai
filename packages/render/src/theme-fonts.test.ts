import { describe, expect, it } from 'vitest'
import type { Ppt4aiDocument } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

const themedDocument: Ppt4aiDocument = {
  format: 'ppt4ai',
  version: 1,
  id: 'dck_fonts',
  page: { w: 12192000, h: 6858000 },
  slides: { sld_1: { id: 'sld_1', elementIds: ['el_text', 'el_table'], layoutId: 'lyt_1' } },
  slideOrder: ['sld_1'],
  elements: {
    el_text: {
      id: 'el_text',
      kind: 'text',
      bounds: { x: 1000000, y: 1000000, w: 4000000, h: 2000000 },
      body: {
        paragraphs: [
          {
            attrs: { bullet: { type: 'char', char: '•', fontFamily: '+mn-lt' } },
            runs: [
              { text: 'Heading ', marks: { fontFamily: '+mj-lt' } },
              { text: 'literal', marks: { fontFamily: 'Georgia' } },
            ],
          },
          { runs: [{ text: 'unresolvable', marks: { fontFamily: '+mj-cs' } }] },
        ],
      },
    },
    el_table: {
      id: 'el_table',
      kind: 'table',
      bounds: { x: 6000000, y: 1000000, w: 4000000, h: 1000000 },
      columns: [4000000],
      rows: [{
        height: 1000000,
        cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'Cell', marks: { fontFamily: '+mn-lt' } }] }] } }],
      }],
    },
  },
  layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } },
  masters: { mst_1: { id: 'mst_1', themeId: 'theme-1' } },
  themes: {
    'theme-1': {
      id: 'theme-1',
      colors: {},
      fonts: { major: { latin: 'Cambria' }, minor: { latin: 'Calibri' } },
    },
  },
}

function textLines(document: Ppt4aiDocument) {
  const node = documentToSceneGraph(document).nodes.find((candidate) => candidate.id === 'el_text')
  if (node?.kind !== 'text') throw new Error('fixture did not build a text node')
  return node.layout.lines
}

describe('theme font references in the scene graph', () => {
  it('resolves run references and leaves literal families untouched', () => {
    const runs = textLines(themedDocument)[0]?.runs

    expect(runs?.[0]).toMatchObject({ text: 'Heading ', marks: { fontFamily: '+mj-lt' }, resolvedFontFamily: 'Cambria' })
    expect(runs?.[1]).toEqual({ ...runs?.[1], text: 'literal' })
    expect(runs?.[1]).not.toHaveProperty('resolvedFontFamily')
  })

  it('resolves the bullet marker font', () => {
    expect(textLines(themedDocument)[0]?.marker).toMatchObject({ text: '• ', resolvedFontFamily: 'Calibri' })
  })

  /** `cs` is empty in every stock theme, so the reference has nothing to resolve to; painting falls back. */
  it('leaves a reference with no theme value unresolved', () => {
    const line = textLines(themedDocument).find((candidate) => candidate.paragraphIndex === 1)

    expect(line?.runs[0]).toMatchObject({ text: 'unresolvable', marks: { fontFamily: '+mj-cs' } })
    expect(line?.runs[0]).not.toHaveProperty('resolvedFontFamily')
  })

  it('resolves references inside table cell text', () => {
    const node = documentToSceneGraph(themedDocument).nodes.find((candidate) => candidate.id === 'el_table')
    if (node?.kind !== 'table') throw new Error('fixture did not build a table node')

    expect(node.layout.cells[0]?.textLayout.lines[0]?.runs[0]).toMatchObject({ text: 'Cell', resolvedFontFamily: 'Calibri' })
  })

  it('resolves against the built-in fonts when the theme carries none', () => {
    const document = structuredClone(themedDocument)
    delete document.themes?.['theme-1']?.fonts

    expect(textLines(document)[0]?.runs[0]).toMatchObject({ resolvedFontFamily: 'Aptos Display' })
  })

  it('keeps the scene structured-clone safe', () => {
    const graph = documentToSceneGraph(themedDocument)

    expect(structuredClone(graph)).toEqual(graph)
  })
})

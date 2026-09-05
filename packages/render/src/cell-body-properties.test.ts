import { describe, expect, it } from 'vitest'
import { documentToSceneGraph } from './scenegraph'
import type { Ppt4aiDocument, TextBodyProperties } from '@ppt4ai/model'

function documentWith(cellBodyPr?: TextBodyProperties): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_cell_anchor',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['tbl_1'] } },
    slideOrder: ['sld_1'],
    elements: {
      tbl_1: {
        id: 'tbl_1',
        kind: 'table',
        bounds: { x: 0, y: 0, w: 2000000, h: 2000000 },
        columns: [2000000],
        rows: [{
          height: 2000000,
          cells: [{
            column: 0,
            body: { paragraphs: [{ runs: [{ text: 'Cell', marks: { fontSize: 18 } }] }] },
            ...(cellBodyPr ? { cellBodyPr } : {}),
          }],
        }],
      },
    },
  }
}

function firstLineY(document: Ppt4aiDocument): number {
  const graph = documentToSceneGraph(document)
  const node = graph.nodes.find(n => n.kind === 'table')
  if (!node || node.kind !== 'table') throw new Error('expected a table node')
  const line = node.layout.cells[0]?.textLayout.lines[0]
  if (!line) throw new Error('expected a laid-out line')
  return line.y
}

describe('cell body properties in the scene', () => {
  /** `anchor` absent means top, so a cell that states nothing lays out exactly as it always did. */
  it('lays out a cell with no tcPr framing at the top', () => {
    expect(firstLineY(documentWith())).toBe(firstLineY(documentWith({ verticalAlign: 'top' })))
  })

  it('pushes the text down for a centred anchor and further for a bottom one', () => {
    const top = firstLineY(documentWith({ verticalAlign: 'top' }))
    const middle = firstLineY(documentWith({ verticalAlign: 'middle' }))
    const bottom = firstLineY(documentWith({ verticalAlign: 'bottom' }))

    expect(middle).toBeGreaterThan(top)
    expect(bottom).toBeGreaterThan(middle)
  })

  it('insets the text by the cell margins', () => {
    const bare = firstLineY(documentWith())
    const inset = firstLineY(documentWith({ insets: { left: 91440, top: 457200, right: 91440, bottom: 45720 } }))

    expect(inset).toBe(bare + 457200)
  })

  /** The cell's own `a:bodyPr` is the more specific of the two, so it wins where it states something. */
  it('lets the body\'s own bodyPr override the tcPr framing', () => {
    const document = documentWith({ verticalAlign: 'bottom' })
    const table = document.elements.tbl_1
    if (table?.kind !== 'table') throw new Error('fixture table missing')
    table.rows[0]!.cells[0]!.body.bodyPr = { verticalAlign: 'top' }

    expect(firstLineY(document)).toBe(firstLineY(documentWith({ verticalAlign: 'top' })))
  })
})

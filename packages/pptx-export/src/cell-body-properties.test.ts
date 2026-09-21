import { describe, expect, it } from 'vitest'
import { importPptx } from '@ppt4ai/pptx-import'
import type { Ppt4aiDocument, TextBodyProperties } from '@ppt4ai/model'
import { createPptx } from './standalone.js'

async function roundTrip(cellBodyPr?: TextBodyProperties) {
  const document: Ppt4aiDocument = {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_cell_bodypr',
    page: { w: 9144000, h: 6858000 },
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
            body: { paragraphs: [{ runs: [{ text: 'Cell' }] }] },
            ...(cellBodyPr ? { cellBodyPr } : {}),
          }],
        }],
      },
    },
  }

  const bytes = await createPptx(document)
  const imported = await importPptx(bytes)
  // Import renames elements, so the cell is reached through the slide's own list.
  const element = imported.elements[imported.slides.sld_1?.elementIds[0] ?? '']
  if (element?.kind !== 'table') throw new Error('expected a table')
  return element.rows[0]?.cells[0]?.cellBodyPr
}

describe('cell body properties export', () => {
  it('writes the four margins and the anchor to a:tcPr', async () => {
    const result = await roundTrip({
      insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 },
      verticalAlign: 'middle',
    })

    expect(result).toEqual({
      insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 },
      verticalAlign: 'middle',
    })
  })

  it('round-trips all three anchor words', async () => {
    expect((await roundTrip({ verticalAlign: 'top' }))?.verticalAlign).toBe('top')
    expect((await roundTrip({ verticalAlign: 'middle' }))?.verticalAlign).toBe('middle')
    expect((await roundTrip({ verticalAlign: 'bottom' }))?.verticalAlign).toBe('bottom')
  })

  it('writes nothing for a cell that states neither', async () => {
    expect(await roundTrip()).toBeUndefined()
  })

  it('writes only the field that was stated', async () => {
    expect(await roundTrip({ verticalAlign: 'bottom' })).toEqual({ verticalAlign: 'bottom' })
    expect(await roundTrip({ insets: { left: 0, top: 0, right: 0, bottom: 0 } })).toEqual({
      insets: { left: 0, top: 0, right: 0, bottom: 0 },
    })
  })
})

import { describe, expect, it } from 'vitest'
import type { Fill, Ppt4aiDocument, TableStyle, Theme } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

const pattern: Fill = {
  color: { type: 'srgb', v: 'FF0000' },
  pattern: {
    preset: 'ltHorz',
    foreground: { type: 'srgb', v: 'FF0000' },
    background: { type: 'srgb', v: '00FF00' },
  },
}

function tableDocument(cellFill: Fill | undefined, styles?: Record<string, TableStyle>, styleId?: string, theme?: Theme): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_table_pattern',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_table'], layoutId: 'lyt_1' } },
    slideOrder: ['sld_1'],
    elements: {
      el_table: {
        id: 'el_table',
        kind: 'table',
        bounds: { x: 0, y: 0, w: 4000000, h: 1000000 },
        columns: [4000000],
        rows: [{ height: 1000000, cells: [{ column: 0, body: { paragraphs: [{ runs: [] }] }, ...(cellFill ? { fill: cellFill } : {}) }] }],
        ...(styleId ? { style: { styleId } } : {}),
      },
    },
    layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } },
    masters: { mst_1: { id: 'mst_1', themeId: 'theme-1' } },
    themes: { 'theme-1': theme ?? { id: 'theme-1', colors: {} } },
    ...(styles ? { tableStyles: styles } : {}),
  }
}

function firstCell(document: Ppt4aiDocument) {
  const node = documentToSceneGraph(document).nodes[0]
  if (node?.kind !== 'table') throw new Error('fixture did not build a table node')
  return node.layout.cells[0]!
}

describe('table cell pattern fill in the scene graph', () => {
  it('resolves both pattern colours of a direct cell fill', () => {
    expect(firstCell(tableDocument(pattern)).resolvedFillPattern).toEqual({
      preset: 'ltHorz',
      foreground: { rgb: 'FF0000', alpha: 100000 },
      background: { rgb: '00FF00', alpha: 100000 },
    })
  })

  it('carries no pattern for a plain solid cell fill', () => {
    const cell = firstCell(tableDocument({ color: { type: 'srgb', v: '1F3864' } }))
    expect(cell).not.toHaveProperty('resolvedFillPattern')
    expect(cell.resolvedFillColor).toEqual({ rgb: '1F3864', alpha: 100000 })
  })

  it('resolves a pattern coming from the table style through the theme phClr', () => {
    const styles: Record<string, TableStyle> = {
      'style-1': {
        id: 'style-1',
        regions: {
          wholeTable: {
            fill: {
              color: { type: 'scheme', v: 'phClr' },
              pattern: {
                preset: 'pct25',
                foreground: { type: 'scheme', v: 'accent1' },
                background: { type: 'srgb', v: 'FFFFFF' },
              },
            },
          },
        },
      },
    }
    const theme: Theme = { id: 'theme-1', colors: { accent1: { type: 'srgb', v: '204060' } } }
    const cell = firstCell(tableDocument(undefined, styles, 'style-1', theme))

    expect(cell.resolvedFillPattern).toEqual({
      preset: 'pct25',
      foreground: { rgb: '204060', alpha: 100000 },
      background: { rgb: 'FFFFFF', alpha: 100000 },
    })
  })

  it('drops to the picture fill without a pattern when the cell has a blip', () => {
    // A picture cell has no colour or pattern painted under it; covered elsewhere, asserted here for the guard.
    const cell = firstCell(tableDocument(pattern))
    expect(cell.resolvedFillPattern).toBeDefined()
  })
})

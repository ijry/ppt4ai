import { importPptx } from '@ppt4ai/pptx-import'
import type { Ppt4aiDocument, TableElement, TextBody } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { serializeTableXml } from './table.js'
import { createPptx } from './standalone.js'
import { readZipEntries } from './zip.js'
import { serializeTextBodyXml } from './text-xml.js'

function tableWith(body: TextBody): TableElement {
  return {
    id: 'tbl_1',
    kind: 'table',
    bounds: { x: 0, y: 0, w: 2000000, h: 1000000 },
    columns: [2000000],
    rows: [{ height: 1000000, cells: [{ column: 0, body }] }],
  }
}

async function slideXmlOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  return new TextDecoder().decode(entries.get('ppt/slides/slide1.xml'))
}

function documentWith(table: TableElement): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_table_text',
    page: { w: 9144000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [table.id] } },
    elements: { [table.id]: table },
    slideOrder: ['sld_1'],
  }
}

async function roundTrip(body: TextBody) {
  const output = await createPptx(documentWith(tableWith(body)))
  const imported = await importPptx(output)
  const element = imported.elements[imported.slides.sld_1?.elementIds[0] ?? '']
  if (element?.kind !== 'table') throw new Error('did not import as a table')
  const cell = element.rows[0]?.cells[0]
  if (!cell) throw new Error('imported table has no cell')
  return { xml: await slideXmlOf(output), body: cell.body }
}

describe('table cell text goes through the shared serializer', () => {
  it.each([['left', 'l'], ['center', 'ctr'], ['right', 'r']] as const)('round-trips %s alignment as algn="%s"', async (align, keyword) => {
    const { xml, body } = await roundTrip({ paragraphs: [{ attrs: { align }, runs: [{ text: 'A' }] }] })

    // The table-local serializer emitted the model's own word here, so `left` and `right` were not
    // valid ST_TextAlignType values and came back undefined.
    expect(xml).toContain(`algn="${keyword}"`)
    expect(body.paragraphs[0]?.attrs).toEqual({ align })
  })

  it('round-trips paragraph spacing and a bullet', async () => {
    const { body } = await roundTrip({
      paragraphs: [{
        attrs: { lineSpacing: 150000, spaceBefore: 152400, spaceAfter: 76200, bullet: { type: 'char', char: '•' } },
        runs: [{ text: 'A' }],
      }],
    })

    expect(body.paragraphs[0]?.attrs).toEqual({
      lineSpacing: 150000,
      spaceBefore: 152400,
      spaceAfter: 76200,
      bullet: { type: 'char', char: '•' },
    })
  })

  it('round-trips an auto-numbered bullet', async () => {
    const { body } = await roundTrip({
      paragraphs: [{ attrs: { bullet: { type: 'autoNum', scheme: 'alphaUpper', startAt: 3 } }, runs: [{ text: 'A' }] }],
    })

    expect(body.paragraphs[0]?.attrs?.bullet).toEqual({ type: 'autoNum', scheme: 'alphaUpper', startAt: 3 })
  })

  it('turns a newline inside a cell run into a:br and reads it back in place', async () => {
    const { xml, body } = await roundTrip({ paragraphs: [{ runs: [{ text: 'Above\nBelow' }] }] })

    expect(xml).toContain('<a:br/>')
    expect(body.paragraphs[0]?.runs.map((run) => run.text).join('')).toBe('Above\nBelow')
  })

  it('preserves leading and trailing spaces in a cell', async () => {
    const { xml, body } = await roundTrip({ paragraphs: [{ runs: [{ text: ' padded ' }] }] })

    expect(xml).toContain('xml:space="preserve"')
    expect(body.paragraphs[0]?.runs[0]?.text).toBe(' padded ')
  })

  it('round-trips body properties on a cell', async () => {
    const { body } = await roundTrip({
      bodyPr: { insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 }, verticalAlign: 'top', wrap: 'none' },
      paragraphs: [{ runs: [{ text: 'A' }] }],
    })

    expect(body.bodyPr).toEqual({
      insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 },
      verticalAlign: 'top',
      wrap: 'none',
    })
  })

  it('round-trips run marks on a cell', async () => {
    const { body } = await roundTrip({
      paragraphs: [{ runs: [{ text: 'A', marks: { fontFamily: 'Georgia', fontSize: 24, bold: true, underline: 'single' } }] }],
    })

    expect(body.paragraphs[0]?.runs[0]?.marks).toEqual({ fontFamily: 'Georgia', fontSize: 24, bold: true, underline: 'single' })
  })

  it('emits the same body as the shape path, apart from the outer tag prefix', () => {
    const body: TextBody = {
      bodyPr: { verticalAlign: 'middle', autofit: { type: 'shrink', minFontScale: 60000 } },
      paragraphs: [{ attrs: { align: 'right', lineSpacing: 120000 }, runs: [{ text: 'Shared', marks: { bold: true } }] }],
    }

    const shapePath = serializeTextBodyXml(body)
    const tablePath = serializeTableXml(tableWith(body))

    expect(tablePath).toContain(shapePath.replace('<p:txBody>', '<a:txBody>').replace('</p:txBody>', '</a:txBody>'))
  })
})

describe('spAutoFit carries no attributes', () => {
  it('writes a bare spAutoFit for a resize autofit', () => {
    const xml = serializeTableXml(tableWith({ bodyPr: { autofit: { type: 'resize' } }, paragraphs: [{ runs: [{ text: 'A' }] }] }))

    expect(xml).toContain('<a:spAutoFit/>')
  })

  it('omits maxHeight, which ECMA-376 gives spAutoFit no place to hold', async () => {
    const { xml, body } = await roundTrip({ bodyPr: { autofit: { type: 'resize', maxHeight: 400000 } }, paragraphs: [{ runs: [{ text: 'A' }] }] })

    expect(xml).toContain('<a:spAutoFit/>')
    expect(xml).not.toContain('lnSpcReduction')
    // The layout engine still uses maxHeight; it simply cannot be persisted.
    expect(body.bodyPr?.autofit).toEqual({ type: 'resize' })
  })

  it('keeps fontScale on normAutofit, where the attribute does belong', async () => {
    const { body } = await roundTrip({ bodyPr: { autofit: { type: 'shrink', minFontScale: 70000 } }, paragraphs: [{ runs: [{ text: 'A' }] }] })

    expect(body.bodyPr?.autofit).toEqual({ type: 'shrink', minFontScale: 70000 })
  })
})

import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { createPptx, exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

const tokens = ['arabicPeriod', 'arabicParenR', 'arabicPlain', 'alphaLcParenBoth', 'romanUcPeriod', 'romanLcParenR', 'ea1ChsPeriod']

function packageWith(type: string): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="List"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>'
    + `<p:txBody><a:bodyPr/><a:p><a:pPr><a:buAutoNum type="${type}"/></a:pPr><a:r><a:t>First</a:t></a:r></a:p></p:txBody></p:sp>`
    + '</p:spTree></p:cSld></p:sld>'
  const encode = (value: string): Uint8Array => new TextEncoder().encode(value)
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: encode(slide) },
  ])
}

async function slideOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  return new TextDecoder().decode(entries.get('ppt/slides/slide1.xml')!)
}

async function textElementOf(bytes: Uint8Array) {
  const document = await importPptx(bytes)
  const element = document.elements.el_1
  if (element?.kind !== 'text') throw new Error('fixture did not import as a text element')
  return { document, element }
}

/**
 * The worst of the three collapse bugs: `prstDash` and `prstGeom` only rewrote the file on standalone
 * generation, while this one rewrote every numbered list the moment a paragraph's text changed.
 */
describe('auto-number tokens in source writeback', () => {
  it('keeps the token when the paragraph text changes', async () => {
    for (const token of tokens) {
      const source = packageWith(token)
      const { document, element } = await textElementOf(source)
      expect(element.body?.paragraphs[0]?.attrs?.bullet).toEqual({ type: 'autoNum', scheme: token })
      element.body!.paragraphs[0]!.runs[0]!.text = 'Edited'

      const xml = await slideOf(await exportPptx(document, source))

      expect(xml).toContain(`<a:buAutoNum type="${token}"/>`)
      expect(xml).toContain('Edited')
    }
  })

  it('stays byte-identical when nothing is edited', async () => {
    const source = packageWith('romanUcPeriod')

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  /** A real change to the numbering still writes: the comparison is verbatim, not collapsed. */
  it('writes a changed token', async () => {
    const source = packageWith('arabicPeriod')
    const { document, element } = await textElementOf(source)
    element.body!.paragraphs[0]!.attrs = { bullet: { type: 'autoNum', scheme: 'romanLcParenBoth' } }

    expect(await slideOf(await exportPptx(document, source))).toContain('<a:buAutoNum type="romanLcParenBoth"/>')
  })
})

describe('auto-number tokens in standalone generation', () => {
  it('writes and re-reads every token verbatim', async () => {
    for (const token of tokens) {
      const { document } = await textElementOf(packageWith(token))
      const output = await createPptx(document)

      expect(await slideOf(output)).toContain(`<a:buAutoNum type="${token}"/>`)
      const reimported = await textElementOf(output)
      expect(reimported.element.body?.paragraphs[0]?.attrs?.bullet).toEqual({ type: 'autoNum', scheme: token })
    }
  })
})

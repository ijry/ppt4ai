import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { createPptx, exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const tokens = ['sng', 'dbl', 'heavy', 'dotted', 'dashed', 'wavy', 'wavyDbl', 'dotDotDashHeavy']

function packageWith(underline: string): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>'
    + `<p:txBody><a:bodyPr/><a:p><a:r><a:rPr u="${underline}"/><a:t>Underlined</a:t></a:r></a:p></p:txBody></p:sp>`
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

async function textOf(bytes: Uint8Array) {
  const document = await importPptx(bytes)
  const element = document.elements[document.slides.sld_1?.elementIds[0] ?? ''] ?? document.elements.el_1
  if (element?.kind !== 'text') throw new Error('fixture did not import as a text element')
  return { document, element }
}

/** Like the auto-number tokens, this one was rewritten by an ordinary text edit, not just by export. */
describe('underline tokens survive the round trip', () => {
  it('keeps the word when the run text changes', async () => {
    for (const token of tokens) {
      const source = packageWith(token)
      const { document, element } = await textOf(source)
      expect(element.body?.paragraphs[0]?.runs[0]?.marks?.underline).toBe(token)
      element.body!.paragraphs[0]!.runs[0]!.text = 'Edited'

      const xml = await slideOf(await exportPptx(document, source))

      expect(xml).toContain(`u="${token}"`)
      expect(xml).toContain('Edited')
    }
  })

  it('stays byte-identical when nothing is edited', async () => {
    const source = packageWith('dbl')

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  it('writes every word in standalone generation and reads it back', async () => {
    for (const token of tokens) {
      const { document } = await textOf(packageWith(token))
      const output = await createPptx(document)

      expect(await slideOf(output)).toContain(`u="${token}"`)
      expect((await textOf(output)).element.body?.paragraphs[0]?.runs[0]?.marks?.underline).toBe(token)
    }
  })

  it('keeps an explicit none, which overrides an inherited underline', async () => {
    const { document, element } = await textOf(packageWith('none'))
    expect(element.body?.paragraphs[0]?.runs[0]?.marks?.underline).toBe('none')

    expect(await slideOf(await createPptx(document))).toContain('u="none"')
  })

  /** The toolbar writes OOXML's own word, so a document built in the editor serializes a real token. */
  it('writes sng for an underline switched on in the editor', async () => {
    const { document, element } = await textOf(packageWith('none'))
    element.body!.paragraphs[0]!.runs[0]!.marks = { underline: 'sng' }

    expect(await slideOf(await createPptx(document))).toContain('u="sng"')
  })
})

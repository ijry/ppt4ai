import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="1" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

function slideWith(txBody: string): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Formatted"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr>'
    + `<p:txBody>${txBody}</p:txBody></p:sp>`
    + '</p:spTree></p:cSld></p:sld>'
}

function packageWith(txBody: string): Uint8Array {
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: new TextEncoder().encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode(slideWith(txBody)) },
  ])
}

const formattedBody = '<a:bodyPr/>'
  + '<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="3200" b="1" u="sng">'
  + '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:latin typeface="Georgia"/></a:rPr><a:t>Formatted</a:t></a:r></a:p>'

async function slideXmlOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  return new TextDecoder().decode(entries.get('ppt/slides/slide1.xml'))
}

async function importedText(bytes: Uint8Array) {
  const element = (await importPptx(bytes)).elements.el_1
  if (element?.kind !== 'text') throw new Error('fixture did not import as text')
  return element
}

describe('formatted text survives a writeback edit', () => {
  it('keeps run marks and paragraph attributes when the text changes', async () => {
    const source = packageWith(formattedBody)
    const document = await importPptx(source)
    const text = document.elements.el_1
    if (text?.kind !== 'text') throw new Error('fixture did not import as text')
    const marks = text.body?.paragraphs[0]?.runs[0]?.marks
    text.body = { paragraphs: [{ attrs: text.body?.paragraphs[0]?.attrs, runs: [{ text: 'Edited', ...(marks ? { marks } : {}) }] }] }

    const output = await exportPptx(document, source)
    const outputSlide = await slideXmlOf(output)

    expect(outputSlide).toContain('Edited')
    expect(outputSlide).toContain('typeface="Georgia"')
    expect(outputSlide).toContain('sz="3200"')
    expect(outputSlide).toContain('algn="ctr"')
    expect((await importedText(output)).body?.paragraphs[0]).toEqual({
      attrs: { align: 'center' },
      runs: [{
        text: 'Edited',
        marks: { fontFamily: 'Georgia', fontSize: 32, bold: true, underline: 'single', color: { color: { type: 'srgb', v: 'FF0000' } } },
      }],
    })
  })

  it('writes a marks-only edit, which text-content comparison used to skip', async () => {
    const source = packageWith(formattedBody)
    const document = await importPptx(source)
    const text = document.elements.el_1
    if (text?.kind !== 'text') throw new Error('fixture did not import as text')
    text.body = { paragraphs: [{ runs: [{ text: 'Formatted', marks: { fontFamily: 'Verdana' } }] }] }

    const output = await exportPptx(document, source)

    expect(await slideXmlOf(output)).toContain('typeface="Verdana"')
    expect((await importedText(output)).body?.paragraphs[0]?.runs[0]?.marks).toEqual({ fontFamily: 'Verdana' })
  })

  it('writes a paragraph-attribute-only edit', async () => {
    const source = packageWith(formattedBody)
    const document = await importPptx(source)
    const text = document.elements.el_1
    if (text?.kind !== 'text') throw new Error('fixture did not import as text')
    const paragraph = text.body?.paragraphs[0]
    if (!paragraph) throw new Error('fixture paragraph is missing')
    paragraph.attrs = { align: 'right' }

    expect(await slideXmlOf(await exportPptx(document, source))).toContain('algn="r"')
  })

  it('leaves the package byte-identical when nothing is edited', async () => {
    const source = packageWith(formattedBody)
    const document = await importPptx(source)

    expect(await exportPptx(document, source)).toEqual(source)
  })

  it('does not rewrite txBody when an unrelated field changes', async () => {
    const source = packageWith(formattedBody)
    const document = await importPptx(source)
    const text = document.elements.el_1
    if (text?.kind !== 'text') throw new Error('fixture did not import as text')
    text.bounds = { ...text.bounds, x: 2000000 }

    const outputSlide = await slideXmlOf(await exportPptx(document, source))

    // The source rPr is preserved verbatim rather than re-serialized from the model.
    expect(outputSlide).toContain('<a:rPr sz="3200" b="1" u="sng">')
    expect(outputSlide).toContain('<a:off x="2000000" y="1000000"/>')
  })

  it('drops formatting the model no longer carries', async () => {
    const source = packageWith(formattedBody)
    const document = await importPptx(source)
    const text = document.elements.el_1
    if (text?.kind !== 'text') throw new Error('fixture did not import as text')
    text.body = { paragraphs: [{ runs: [{ text: 'Formatted' }] }] }

    const outputSlide = await slideXmlOf(await exportPptx(document, source))

    // Clearing marks is a real edit, not a no-op: the model is the source of truth once it differs.
    expect(outputSlide).not.toContain('typeface="Georgia"')
    expect(outputSlide).toContain('<a:t>Formatted</a:t>')
  })
})

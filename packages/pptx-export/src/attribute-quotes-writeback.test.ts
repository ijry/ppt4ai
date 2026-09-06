import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

/**
 * A source package may quote an attribute either way, and one of these writebacks used to notice only
 * `"…"`. On a miss it inserted the attribute instead of replacing it, so changing a stroke width on
 * `<a:ln w='12700'>` produced two `w` attributes — a fatal XML well-formedness error, and on the readers
 * lenient enough to accept it (this project's importer included) the last one wins, which is the old
 * value. So every case here asserts three things: the new value is in, the quote character is untouched,
 * and the attribute appears exactly once.
 */

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

function sourcePackage(shapeProperties: string): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Quoted"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `<a:prstGeom prst="rect"/>${shapeProperties}</p:spPr>`
    + '<p:txBody><a:bodyPr/><a:p><a:r><a:t>Quoted</a:t></a:r></a:p></p:txBody></p:sp>'
    + '</p:spTree></p:cSld></p:sld>'
  const encode = (value: string) => new TextEncoder().encode(value)
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: encode(slide) },
  ])
}

async function slideXmlOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  const data = entries.get('ppt/slides/slide1.xml')
  if (!data) throw new Error('missing slide')
  return new TextDecoder().decode(data)
}

function occurrences(xml: string, needle: string): number {
  return xml.split(needle).length - 1
}

const solid = '<a:solidFill><a:srgbClr val="112233"/></a:solidFill>'

describe('changing an attribute a source wrote in single quotes', () => {
  it('replaces the stroke width and cap in place, once each', async () => {
    const source = sourcePackage(`<a:ln w='12700' cap='rnd' cmpd='dbl' algn='ctr'>${solid}</a:ln>`)
    const document = await importPptx(source)
    const element = document.elements.el_1
    if (element?.kind !== 'text') throw new Error('fixture did not import as text')
    element.strokeWidth = 25400
    element.strokeCap = 'flat'

    const exported = await exportPptx(document, source)
    const line = (await slideXmlOf(exported)).match(/<a:ln[^>]*>/u)?.[0] ?? ''

    expect(line).toContain("w='25400'")
    expect(line).toContain("cap='flat'")
    expect(occurrences(line, 'w=')).toBe(1)
    expect(occurrences(line, 'cap=')).toBe(1)
    // The two nobody edited keep their own quotes, untouched.
    expect(line).toContain("cmpd='dbl'")
    expect(line).toContain("algn='ctr'")

    const reimported = await importPptx(exported)
    const back = reimported.elements.el_1
    if (back?.kind !== 'text') throw new Error('output did not import as text')
    expect(back.strokeWidth).toBe(25400)
    expect(back.strokeCap).toBe('flat')
  })

  it('replaces a pattern preset in place, once', async () => {
    const source = sourcePackage("<a:pattFill prst='dashDnDiag'><a:fgClr><a:srgbClr val=\"112233\"/></a:fgClr><a:bgClr><a:srgbClr val=\"445566\"/></a:bgClr></a:pattFill>")
    const document = await importPptx(source)
    const element = document.elements.el_1
    if (element?.kind !== 'text' || !element.fill?.pattern) throw new Error('fixture did not import a pattern')
    element.fill.pattern.preset = 'ltUpDiag'

    const exported = await exportPptx(document, source)
    const node = (await slideXmlOf(exported)).match(/<a:pattFill[^>]*>/u)?.[0] ?? ''

    expect(node).toContain("prst='ltUpDiag'")
    expect(occurrences(node, 'prst=')).toBe(1)

    const reimported = await importPptx(exported)
    const back = reimported.elements.el_1
    if (back?.kind !== 'text') throw new Error('output did not import as text')
    expect(back.fill?.pattern?.preset).toBe('ltUpDiag')
  })

  it('replaces a shadow measurement in place, once', async () => {
    const source = sourcePackage(`${solid}<a:effectLst><a:outerShdw blurRad='50800' dist='38100' dir='2700000'><a:srgbClr val="000000"/></a:outerShdw></a:effectLst>`)
    const document = await importPptx(source)
    const element = document.elements.el_1
    if (element?.kind !== 'text' || !element.shadow) throw new Error('fixture did not import a shadow')
    element.shadow = { ...element.shadow, blurRadius: 76200 }

    const exported = await exportPptx(document, source)
    const node = (await slideXmlOf(exported)).match(/<a:outerShdw[^>]*>/u)?.[0] ?? ''

    expect(node).toContain("blurRad='76200'")
    expect(occurrences(node, 'blurRad=')).toBe(1)
    expect(node).toContain("dist='38100'")
    expect(node).toContain("dir='2700000'")
  })

  it('removes a single-quoted attribute the model no longer states', async () => {
    const source = sourcePackage(`<a:ln w='12700' cap='rnd'>${solid}</a:ln>`)
    const document = await importPptx(source)
    const element = document.elements.el_1
    if (element?.kind !== 'text') throw new Error('fixture did not import as text')
    delete element.strokeWidth

    const line = (await slideXmlOf(await exportPptx(document, source))).match(/<a:ln[^>]*>/u)?.[0] ?? ''

    expect(line).not.toContain('w=')
    expect(line).toContain("cap='rnd'")
  })

  it('still inserts with double quotes when the attribute is not there at all', async () => {
    const source = sourcePackage(`<a:ln cap='rnd'>${solid}</a:ln>`)
    const document = await importPptx(source)
    const element = document.elements.el_1
    if (element?.kind !== 'text') throw new Error('fixture did not import as text')
    element.strokeWidth = 25400

    const line = (await slideXmlOf(await exportPptx(document, source))).match(/<a:ln[^>]*>/u)?.[0] ?? ''

    expect(line).toBe('<a:ln w="25400" cap=\'rnd\'>')
  })

  it('leaves the double-quoted path exactly as it was', async () => {
    const source = sourcePackage(`<a:ln w="12700" cap="rnd">${solid}</a:ln>`)
    const document = await importPptx(source)
    const element = document.elements.el_1
    if (element?.kind !== 'text') throw new Error('fixture did not import as text')
    element.strokeWidth = 25400

    const line = (await slideXmlOf(await exportPptx(document, source))).match(/<a:ln[^>]*>/u)?.[0] ?? ''

    expect(line).toBe('<a:ln w="25400" cap="rnd">')
  })

  /** The width compares as a number, so padding in the source is not an edit. */
  it('does not touch a padded width that means the same number', async () => {
    const source = sourcePackage(`<a:ln w=' 12700 '>${solid}</a:ln>`)
    const document = await importPptx(source)
    const element = document.elements.el_1
    if (element?.kind !== 'text') throw new Error('fixture did not import as text')
    element.strokeCap = 'flat'

    const line = (await slideXmlOf(await exportPptx(document, source))).match(/<a:ln[^>]*>/u)?.[0] ?? ''

    expect(line).toContain("w=' 12700 '")
  })
})

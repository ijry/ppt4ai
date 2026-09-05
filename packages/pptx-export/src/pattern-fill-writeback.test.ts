import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

/**
 * The `a:extLst` is the discriminator. A colour transform would not do: the model reads `a:alpha`, so a
 * rewrite would re-emit it and come out byte-identical whether or not the comparison worked. Nothing
 * re-emits an unmodeled `extLst`, so its survival proves the fill node was never rewritten.
 */
const sourcePattern = '<a:pattFill prst="ltHorz">'
  + '<a:fgClr><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr></a:fgClr>'
  + '<a:bgClr><a:srgbClr val="00FF00"/></a:bgClr>'
  + '<a:extLst><a:ext uri="{9F1B4A2C-0000-0000-0000-000000000000}"/></a:extLst>'
  + '</a:pattFill>'

function sourcePackage(fill = sourcePattern): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Patterned"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `<a:prstGeom prst="rect"/>${fill}</p:spPr>`
    + '</p:sp>'
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

/** Text-free on purpose: an element carrying text imports as `kind: 'text'` and takes another path. */
async function movedShape(source: Uint8Array) {
  const document = await importPptx(source)
  const element = document.elements.el_1
  if (element?.kind !== 'shape') throw new Error('fixture did not import as a shape')
  element.bounds = { ...element.bounds, x: 2222222 }
  return slideXmlOf(await exportPptx(document, source))
}

describe('pattern fill survives writeback', () => {
  it('leaves the package byte-identical when nothing is edited', async () => {
    const source = sourcePackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  /**
   * The same trap the gradient slice documented, one fill form later: once import produces a pattern, a
   * comparison that does not know `pattFill` calls it "changed" and rewrites the node. Verified to fail
   * before `sourceFill` learned the form — the `extLst` was dropped.
   */
  it('keeps the source pattern verbatim when only the bounds change', async () => {
    const outputSlide = await movedShape(sourcePackage())

    expect(outputSlide).toContain(sourcePattern)
    expect(outputSlide).toContain('x="2222222"')
  })

  it('does not collapse the pattern into a solid fill', async () => {
    expect(await movedShape(sourcePackage())).not.toContain('<a:solidFill>')
  })
})

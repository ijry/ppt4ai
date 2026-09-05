import { importPptx } from '@ppt4ai/pptx-import'
import type { Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { sourceColor, sourceFill, sourceOuterShadow } from './color-source.js'
import { sourceTextBody } from './text-source.js'
import { descendants, scanXml, type XmlElement } from './xml-range.js'
import { writeStoredZip } from './zip.js'

/**
 * The writeback keeps its own readers for what the importer reads — `sourceFill` mirrors
 * `parseDirectFill`, `sourceTextBody` mirrors `parseTextBody`, and so on. They exist because the two
 * layers parse different XML representations, and they are the reason an untouched node stays untouched.
 *
 * A drift between a mirror and its parser is silent in both directions: the comparison either calls an
 * unedited node changed and rewrites it, taking unmodeled content with it, or calls a changed node equal
 * and swallows the edit. This session hit that three times — `sourceFill` not knowing `a:pattFill`,
 * `sourceParagraphAttrs` not knowing `a:defRPr`, and no reader at all for `a:outerShdw`.
 *
 * So each mirror gets the same XML its parser gets, and the two models have to match.
 */

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

function slideXml(shapeProperties: string, textBody = '<p:txBody><a:bodyPr/><a:p/></p:txBody>'): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Mirrored"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `<a:prstGeom prst="rect"/>${shapeProperties}</p:spPr>${textBody}</p:sp>`
    + '</p:spTree></p:cSld></p:sld>'
}

function packageOf(slide: string): Uint8Array {
  const encode = (value: string) => new TextEncoder().encode(value)
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: encode(slide) },
  ])
}

/** Both readings of one slide: the imported element, and the scanned nodes the writeback would see. */
async function bothReadings(slide: string) {
  const document: Ppt4aiDocument = await importPptx(packageOf(slide))
  const element = document.elements.el_1
  if (element?.kind !== 'shape' && element?.kind !== 'text') throw new Error('fixture did not import as a shape or text')
  const scanned = scanXml(slide)
  const node = (localName: string): XmlElement | undefined => descendants(scanned, localName)[0]
  return { element, node }
}

describe('the writeback mirrors agree with the importer', () => {
  it('reads a solid fill the same way', async () => {
    const { element, node } = await bothReadings(slideXml('<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>'))

    expect(sourceFill(node('solidFill'))).toEqual(element.fill)
  })

  it('reads a colour with transforms the same way', async () => {
    const { element, node } = await bothReadings(slideXml(
      '<a:solidFill><a:srgbClr val="4472C4"><a:lumMod val="75000"/><a:satMod val="160000"/><a:comp/></a:srgbClr></a:solidFill>',
    ))

    expect(sourceColor(node('solidFill'))).toEqual(element.fill?.color)
  })

  it('reads a scheme colour the same way', async () => {
    const { element, node } = await bothReadings(slideXml(
      '<a:solidFill><a:schemeClr val="accent1"><a:alpha val="60000"/></a:schemeClr></a:solidFill>',
    ))

    expect(sourceColor(node('solidFill'))).toEqual(element.fill?.color)
  })

  it('reads a linear gradient the same way', async () => {
    const { element, node } = await bothReadings(slideXml(
      '<a:gradFill><a:gsLst>'
      + '<a:gs pos="0"><a:srgbClr val="4472C4"/></a:gs>'
      + '<a:gs pos="100000"><a:srgbClr val="203864"><a:alpha val="60000"/></a:srgbClr></a:gs>'
      + '</a:gsLst><a:lin ang="5400000" scaled="1"/></a:gradFill>',
    ))

    expect(sourceFill(node('gradFill'))).toEqual(element.fill)
  })

  it('reads a pattern fill the same way', async () => {
    const { element, node } = await bothReadings(slideXml(
      '<a:pattFill prst="dkUpDiag">'
      + '<a:fgClr><a:srgbClr val="FF0000"/></a:fgClr><a:bgClr><a:srgbClr val="00FF00"/></a:bgClr>'
      + '</a:pattFill>',
    ))

    expect(sourceFill(node('pattFill'))).toEqual(element.fill)
  })

  it('reads an outer shadow the same way', async () => {
    const { element, node } = await bothReadings(slideXml(
      '<a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000">'
      + '<a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw></a:effectLst>',
    ))

    expect(sourceOuterShadow(node('effectLst'))).toEqual(element.shadow)
  })

  it('reads a rich text body the same way', async () => {
    const textBody = '<p:txBody>'
      + '<a:bodyPr lIns="100000" tIns="200000" rIns="300000" bIns="400000" anchor="ctr" wrap="none" vert="vert">'
      + '<a:normAutofit fontScale="50000"/></a:bodyPr>'
      + '<a:p><a:pPr algn="ctr" lvl="2" marL="457200" indent="-228600">'
      + '<a:lnSpc><a:spcPct val="120000"/></a:lnSpc><a:spcBef><a:spcPts val="500"/></a:spcBef>'
      + '<a:buAutoNum type="romanUcParenR" startAt="3"/>'
      + '<a:defRPr sz="3200" b="1"/></a:pPr>'
      + '<a:r><a:rPr sz="2400" b="1" i="1" u="dotted" baseline="30000">'
      + '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>'
      + '<a:latin typeface="Georgia"/><a:ea typeface="微软雅黑"/><a:cs typeface="Arial"/>'
      + '</a:rPr><a:t>Rich</a:t></a:r>'
      + '<a:br/><a:r><a:t>Second</a:t></a:r>'
      + '</a:p></p:txBody>'
    const { element, node } = await bothReadings(slideXml('', textBody))
    const shape = node('sp')
    if (!shape) throw new Error('the scan found no shape')

    expect(sourceTextBody(shape)).toEqual(element.kind === 'text' ? element.body : undefined)
  })

  /** A char bullet with its own typeface takes a different branch from the auto-numbered one. */
  it('reads a character bullet the same way', async () => {
    const textBody = '<p:txBody><a:bodyPr/>'
      + '<a:p><a:pPr><a:buChar char="•"><a:rPr typeface="Wingdings"/></a:buChar></a:pPr>'
      + '<a:r><a:t>Bulleted</a:t></a:r></a:p></p:txBody>'
    const { element, node } = await bothReadings(slideXml('', textBody))
    const shape = node('sp')
    if (!shape) throw new Error('the scan found no shape')

    expect(sourceTextBody(shape)).toEqual(element.kind === 'text' ? element.body : undefined)
  })
})

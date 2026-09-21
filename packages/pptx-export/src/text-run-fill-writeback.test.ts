import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

const gradientRun = '<a:rPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="4472C4"/></a:gs><a:gs pos="100000"><a:srgbClr val="203864"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill></a:rPr>'

function sourcePackage(rPr = gradientRun): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>'
    + `<p:txBody><a:bodyPr/><a:p><a:r>${rPr}<a:t>Hi</a:t></a:r></a:p></p:txBody></p:sp>`
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

describe('text run gradient fill survives writeback', () => {
  it('imports the gradient run fill', async () => {
    const document = await importPptx(sourcePackage())
    const element = document.elements.el_1
    if (element?.kind !== 'text') throw new Error('fixture did not import as text')
    expect(element.body?.paragraphs[0]?.runs[0]?.marks?.color?.gradient?.stops).toHaveLength(2)
  })

  it('leaves the package byte-identical when nothing is edited', async () => {
    const source = sourcePackage()
    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  it('writes a:gradFill for the run when a text edit forces a rewrite', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const element = document.elements.el_1
    if (element?.kind !== 'text') throw new Error('fixture did not import as text')
    element.body!.paragraphs[0]!.runs[0]!.text = 'Edited'

    const xml = await slideOf(await exportPptx(document, source))
    expect(xml).toContain('<a:gradFill>')
    expect(xml).toContain('Edited')
    expect(xml).not.toContain('<a:solidFill>')
  })
})

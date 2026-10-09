import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const enc = (value: string): Uint8Array => new TextEncoder().encode(value)
const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const shape = (id: number, name: string, x: number): string =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
  + `<p:spPr><a:xfrm><a:off x="${x}" y="1000000"/><a:ext cx="1000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:sp>`
const slide = `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>${shape(2, 'Alpha', 1000000)}${shape(3, 'Beta', 4000000)}</p:spTree></p:cSld></p:sld>`

function source(): Uint8Array {
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: enc(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: enc(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: enc(slide) },
  ])
}
async function slideXmlOf(bytes: Uint8Array): Promise<string> {
  const entry = (await readZipEntries(bytes)).find((candidate) => candidate.name === 'ppt/slides/slide1.xml')
  if (!entry) throw new Error('missing slide')
  return new TextDecoder().decode(entry.data)
}

describe('element deletion writeback (reuse, leaf nodes)', () => {
  it('removes a deleted shape node and keeps the rest', async () => {
    const src = source()
    const document = await importPptx(src)
    const slideId = document.slideOrder[0]!
    expect(document.slides[slideId]!.elementIds).toEqual(['el_1', 'el_2'])

    delete document.elements.el_2
    document.slides[slideId]!.elementIds = ['el_1']

    const slideXml = await slideXmlOf(await exportPptx(document, src))
    expect(slideXml).toContain('name="Alpha"') // kept
    expect(slideXml).not.toContain('name="Beta"') // deleted node removed
  })

  it('re-imports with the deleted element gone', async () => {
    const src = source()
    const document = await importPptx(src)
    const slideId = document.slideOrder[0]!
    delete document.elements.el_1
    document.slides[slideId]!.elementIds = ['el_2']

    const reimported = await importPptx(await exportPptx(document, src))
    expect(Object.keys(reimported.elements)).toEqual(['el_1']) // one shape left, renumbered on fresh import
    const slideXml = await slideXmlOf(await exportPptx(document, src))
    expect(slideXml).toContain('name="Beta"')
    expect(slideXml).not.toContain('name="Alpha"')
  })

  it('leaves the package byte-identical when nothing is deleted', async () => {
    const src = source()
    expect(await exportPptx(await importPptx(src), src)).toEqual(src)
  })
})

const groupSlide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
  + '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="10" name="Grp"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
  + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="2000000"/><a:chOff x="0" y="0"/><a:chExt cx="2000000" cy="2000000"/></a:xfrm></p:grpSpPr>'
  + shape(11, 'Inner1', 0) + shape(12, 'Inner2', 500000)
  + '</p:grpSp>'
  + shape(3, 'Top', 4000000)
  + '</p:spTree></p:cSld></p:sld>'
function groupSource(): Uint8Array {
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: enc(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: enc(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: enc(groupSlide) },
  ])
}

describe('element deletion writeback (reuse, group subtree)', () => {
  it('removes a deleted group with its whole subtree, keeping siblings', async () => {
    const src = groupSource()
    const document = await importPptx(src)
    const slideId = document.slideOrder[0]!
    const group = Object.values(document.elements).find((element) => element.kind === 'group')
    if (!group || group.kind !== 'group') throw new Error('fixture group did not import')
    const removed = new Set([group.id, ...group.childIds])
    for (const id of removed) delete document.elements[id]
    document.slides[slideId]!.elementIds = document.slides[slideId]!.elementIds.filter((id) => !removed.has(id))

    const slideXml = await slideXmlOf(await exportPptx(document, src))
    expect(slideXml).not.toContain('name="Grp"') // group frame removed
    expect(slideXml).not.toContain('name="Inner1"') // ...with its children
    expect(slideXml).not.toContain('name="Inner2"')
    expect(slideXml).toContain('name="Top"') // sibling kept
  })
})

import { importPptx } from '@ppt4ai/pptx-import'
import type { Ppt4aiDocument, TextMarks } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx, exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

const defaultMarks: TextMarks = { fontSize: 32, bold: true }

function documentWith(marks?: TextMarks): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_def_rpr',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['text_1'] } },
    slideOrder: ['sld_1'],
    elements: {
      text_1: {
        id: 'text_1',
        kind: 'text',
        bounds: { x: 0, y: 0, w: 2000000, h: 1000000 },
        body: {
          paragraphs: [{
            attrs: { align: 'center', ...(marks ? { defaultMarks: marks } : {}) },
            runs: [{ text: 'Titled' }],
          }],
        },
      },
    },
  }
}

/** The `a:extLst` is the discriminator: nothing re-emits it, so its survival proves no rewrite. */
const sourceBody = '<p:txBody><a:bodyPr/>'
  + '<a:p><a:pPr algn="ctr"><a:defRPr sz="3200" b="1"/></a:pPr>'
  + '<a:r><a:t>Titled</a:t></a:r>'
  + '<a:extLst><a:ext uri="{7C3B4A11-0000-0000-0000-000000000000}"/></a:extLst>'
  + '</a:p></p:txBody>'

function sourcePackage(): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Titled"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm></p:spPr>'
    + `${sourceBody}</p:sp></p:spTree></p:cSld></p:sld>`
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

async function edited(change: (attrs: Record<string, unknown>) => void): Promise<string> {
  const source = sourcePackage()
  const document = await importPptx(source)
  const element = document.elements.el_1
  if (element?.kind !== 'text') throw new Error('fixture did not import as text')
  const attrs = element.body?.paragraphs[0]?.attrs
  if (!attrs) throw new Error('fixture lost its paragraph attributes')
  change(attrs as unknown as Record<string, unknown>)
  return slideXmlOf(await exportPptx(document, source))
}

describe('paragraph defRPr on standalone export', () => {
  /** The loss: only the `a:lstStyle` path passed defaultMarks, so a paragraph-level one was dropped. */
  it('writes the paragraph default marks', async () => {
    expect(await slideXmlOf(await createPptx(documentWith(defaultMarks))))
      .toContain('<a:pPr algn="ctr"><a:defRPr sz="3200" b="1"></a:defRPr></a:pPr>')
  })

  it('writes no defRPr when the paragraph has none', async () => {
    const slide = await slideXmlOf(await createPptx(documentWith()))

    expect(slide).toContain('<a:pPr algn="ctr"/>')
    expect(slide).not.toContain('defRPr')
  })

  it('brings the default marks back through import', async () => {
    const reimported = await importPptx(await createPptx(documentWith(defaultMarks)))
    const element = reimported.elements[reimported.slides.sld_1?.elementIds[0] ?? '']
    if (element?.kind !== 'text') throw new Error('the generated element did not import as text')

    expect(element.body?.paragraphs[0]?.attrs?.defaultMarks).toEqual(defaultMarks)
  })
})

describe('paragraph defRPr in source writeback', () => {
  it('stays byte-identical when nothing is edited', async () => {
    const source = sourcePackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  /**
   * The trap the design named: making the serializer write `a:defRPr` without teaching the comparison to
   * read it would call every such paragraph edited and rewrite the whole `txBody`, taking the extLst with
   * it. Verified to fail before `sourceParagraphAttrs` learned the node.
   */
  it('leaves the text body untouched when only the bounds change', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const element = document.elements.el_1
    if (element?.kind !== 'text') throw new Error('fixture did not import as text')
    element.bounds = { ...element.bounds, x: 2222222 }

    const slide = await slideXmlOf(await exportPptx(document, source))

    expect(slide).toContain('x="2222222"')
    expect(slide).toContain(sourceBody)
  })

  it('writes a changed default mark', async () => {
    const slide = await edited((attrs) => { attrs.defaultMarks = { fontSize: 18 } })

    expect(slide).toContain('<a:defRPr sz="1800">')
    expect(slide).not.toContain('sz="3200"')
  })

  it('removes the node when the default marks go away', async () => {
    const slide = await edited((attrs) => { delete attrs.defaultMarks })

    expect(slide).not.toContain('defRPr')
    expect(slide).toContain('algn="ctr"')
  })
})

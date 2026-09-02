import { describe, expect, it } from 'vitest'
import { resolveInheritedElement } from '@ppt4ai/model'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

function layoutWith(txBody: string): string {
  return '<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="500000" y="400000"/><a:ext cx="8000000" cy="1200000"/></a:xfrm></p:spPr>'
    + txBody
    + '</p:sp></p:spTree></p:cSld></p:sldLayout>'
}

function masterWith(txBody: string): string {
  return '<p:sldMaster xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="1" name="Title Placeholder"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="500000" y="400000"/><a:ext cx="8000000" cy="1200000"/></a:xfrm></p:spPr>'
    + txBody
    + '</p:sp></p:spTree></p:cSld></p:sldMaster>'
}

function slideWith(txBody: string): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="500000" y="400000"/><a:ext cx="8000000" cy="1200000"/></a:xfrm></p:spPr>'
    + txBody
    + '</p:sp></p:spTree></p:cSld></p:sld>'
}

const formattedTxBody = '<p:txBody><a:bodyPr anchor="ctr"/>'
  + '<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="4400" b="1"><a:latin typeface="Georgia"/></a:rPr><a:t>Layout title</a:t></a:r></a:p>'
  + '</p:txBody>'

const plainSlideTxBody = '<p:txBody><a:bodyPr/><a:p><a:r><a:t>Slide title</a:t></a:r></a:p></p:txBody>'

async function importWith(overrides: Record<string, string>) {
  return importPptx(createStoredZip({ ...files, ...overrides }))
}

describe('placeholder text formatting reaches layout and master defaults', () => {
  it('reads a layout placeholder body, not just its flat text', async () => {
    const document = await importWith({
      'ppt/slideLayouts/slideLayout1.xml': layoutWith(formattedTxBody),
      'ppt/slides/slide1.xml': slideWith(plainSlideTxBody),
    })

    expect(Object.values(document.layouts ?? {})[0]?.defaults?.title?.body).toEqual({
      bodyPr: { verticalAlign: 'middle' },
      paragraphs: [{
        attrs: { align: 'center' },
        runs: [{ text: 'Layout title', marks: { fontFamily: 'Georgia', fontSize: 44, bold: true } }],
      }],
    })
  })

  it('reads a master placeholder body', async () => {
    const document = await importWith({
      'ppt/slideMasters/slideMaster1.xml': masterWith(formattedTxBody),
      'ppt/slides/slide1.xml': slideWith(plainSlideTxBody),
    })

    expect(Object.values(document.masters ?? {})[0]?.defaults?.title?.body).toMatchObject({
      paragraphs: [{ attrs: { align: 'center' } }],
    })
  })

  it('keeps the flat text field alongside the body', async () => {
    const document = await importWith({
      'ppt/slideLayouts/slideLayout1.xml': layoutWith(formattedTxBody),
      'ppt/slides/slide1.xml': slideWith(plainSlideTxBody),
    })

    // Both are kept: master-layout-writeback compares against `text` in its no-body path.
    expect(Object.values(document.layouts ?? {})[0]?.defaults?.title?.text).toBe('Layout title')
  })

  it('omits body for a placeholder that has no txBody at all', async () => {
    const document = await importWith({
      'ppt/slideLayouts/slideLayout1.xml': layoutWith(''),
      'ppt/slides/slide1.xml': slideWith(plainSlideTxBody),
    })

    expect(Object.values(document.layouts ?? {})[0]?.defaults?.title).not.toHaveProperty('body')
  })

  it('lets the element body win over the inherited one', async () => {
    const document = await importWith({
      'ppt/slideLayouts/slideLayout1.xml': layoutWith(formattedTxBody),
      'ppt/slides/slide1.xml': slideWith(plainSlideTxBody),
    })
    const element = document.elements.el_1
    const layout = Object.values(document.layouts ?? {})[0]
    const master = Object.values(document.masters ?? {})[0]
    if (element?.kind !== 'text') throw new Error('fixture did not import as text')

    const resolved = resolveInheritedElement(element, layout, master)
    if (resolved.kind !== 'text') throw new Error('resolved element changed kind')
    // The slide placeholder carries its own body, so nothing is inherited. Per-property fallback
    // would need the a:defRPr chain, which is a separate slice.
    expect(resolved.body?.paragraphs[0]?.runs[0]?.text).toBe('Slide title')
    expect(resolved.body?.paragraphs[0]?.attrs).toBeUndefined()
  })

  it('inherits the layout body when the element has none', async () => {
    const document = await importWith({
      'ppt/slideLayouts/slideLayout1.xml': layoutWith(formattedTxBody),
      'ppt/slides/slide1.xml': slideWith(plainSlideTxBody),
    })
    const element = document.elements.el_1
    const layout = Object.values(document.layouts ?? {})[0]
    if (element?.kind !== 'text') throw new Error('fixture did not import as text')
    delete element.body

    const resolved = resolveInheritedElement(element, layout, Object.values(document.masters ?? {})[0])
    if (resolved.kind !== 'text') throw new Error('resolved element changed kind')
    expect(resolved.body?.paragraphs[0]?.attrs).toEqual({ align: 'center' })
    expect(resolved.body?.paragraphs[0]?.runs[0]?.marks).toEqual({ fontFamily: 'Georgia', fontSize: 44, bold: true })
  })

  it('prefers the layout body over the master body', async () => {
    const masterBody = '<p:txBody><a:bodyPr/><a:p><a:pPr algn="r"/><a:r><a:t>Master title</a:t></a:r></a:p></p:txBody>'
    const document = await importWith({
      'ppt/slideMasters/slideMaster1.xml': masterWith(masterBody),
      'ppt/slideLayouts/slideLayout1.xml': layoutWith(formattedTxBody),
      'ppt/slides/slide1.xml': slideWith(plainSlideTxBody),
    })
    const element = document.elements.el_1
    if (element?.kind !== 'text') throw new Error('fixture did not import as text')
    delete element.body

    const resolved = resolveInheritedElement(element, Object.values(document.layouts ?? {})[0], Object.values(document.masters ?? {})[0])
    if (resolved.kind !== 'text') throw new Error('resolved element changed kind')
    expect(resolved.body?.paragraphs[0]?.attrs).toEqual({ align: 'center' })
  })
})

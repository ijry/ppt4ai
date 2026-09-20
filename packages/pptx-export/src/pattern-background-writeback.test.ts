import { importPptx } from '@ppt4ai/pptx-import'
import type { SlideBackground } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

/**
 * The `a:extLst` is the discriminator, exactly as in the shape pattern writeback: nothing re-emits an
 * unmodeled `extLst`, so its survival proves the `p:bgPr` fill node was patched, not rewritten.
 */
const sourcePattern = '<a:pattFill prst="ltHorz">'
  + '<a:fgClr><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr></a:fgClr>'
  + '<a:bgClr><a:srgbClr val="00FF00"/></a:bgClr>'
  + '<a:extLst><a:ext uri="{9F1B4A2C-0000-0000-0000-000000000000}"/></a:extLst>'
  + '</a:pattFill>'
const patternBackground = `<p:bg><p:bgPr data-keep="yes">${sourcePattern}<a:effectLst/></p:bgPr></p:bg>`

function packageWith(background: string): Uint8Array {
  const slide = `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld>${background}<p:spTree>`
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Box"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:sp>'
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

describe('pattern background survives writeback', () => {
  it('imports the pattern as the slide background fill', async () => {
    const document = await importPptx(packageWith(patternBackground))

    expect(document.slides.sld_1?.background).toEqual({
      fill: {
        color: { type: 'srgb', v: 'FF0000', transforms: [{ type: 'alpha', value: 50000 }] },
        pattern: {
          preset: 'ltHorz',
          foreground: { type: 'srgb', v: 'FF0000', transforms: [{ type: 'alpha', value: 50000 }] },
          background: { type: 'srgb', v: '00FF00' },
        },
      },
    } satisfies SlideBackground)
  })

  it('leaves the package byte-identical when nothing is edited', async () => {
    const source = packageWith(patternBackground)

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  it('keeps the pattern verbatim, including its extLst, when an unrelated element moves', async () => {
    const source = packageWith(patternBackground)
    const document = await importPptx(source)
    const element = document.elements.el_1
    if (element?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    element.bounds = { ...element.bounds, x: 2222222 }

    const xml = await slideOf(await exportPptx(document, source))

    expect(xml).toContain(sourcePattern)
    expect(xml).toContain('x="2222222"')
    expect(xml).not.toContain('<a:solidFill>')
  })
})


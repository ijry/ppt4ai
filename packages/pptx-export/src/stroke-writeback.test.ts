import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

function packageWith(line: string): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Outlined"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `<a:prstGeom prst="rect"/>${line}</p:spPr></p:sp>`
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

async function shapeOf(source: Uint8Array) {
  const document = await importPptx(source)
  const shape = document.elements.el_1
  if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
  return { document, shape }
}

function lineOf(xml: string): string {
  return xml.slice(xml.indexOf('<a:ln'), xml.indexOf('</a:ln>') + 7)
}

const navy = '<a:solidFill><a:srgbClr val="203864"/></a:solidFill>'

describe('stroke width writeback', () => {
  /** Before this the edit was dropped: the export came back byte-identical to the source. */
  it('writes a changed width and keeps the unmodeled attributes', async () => {
    const source = packageWith(`<a:ln w="12700" cap="rnd">${navy}<a:prstDash val="dash"/></a:ln>`)
    const { document, shape } = await shapeOf(source)
    shape.strokeWidth = 76200

    const line = lineOf(await slideXmlOf(await exportPptx(document, source)))

    expect(line).toContain('w="76200"')
    expect(line).toContain('cap="rnd"')
    expect(line).toContain('<a:prstDash val="dash"/>')
    expect(line).toContain('val="203864"')
  })

  it('inserts a width when the source declares none', async () => {
    const source = packageWith(`<a:ln cap="rnd">${navy}</a:ln>`)
    const { document, shape } = await shapeOf(source)
    shape.strokeWidth = 19050

    expect(lineOf(await slideXmlOf(await exportPptx(document, source)))).toContain('<a:ln w="19050" cap="rnd">')
  })

  /**
   * An absent `w` inherits the theme line width while `w="0"` is an explicit hairline, so a model
   * that carries no width has to remove the attribute rather than leave the source value behind.
   */
  it('removes the width when the model carries none', async () => {
    const source = packageWith(`<a:ln w="12700" cap="rnd">${navy}</a:ln>`)
    const { document, shape } = await shapeOf(source)
    delete shape.strokeWidth

    const line = lineOf(await slideXmlOf(await exportPptx(document, source)))

    expect(line).not.toContain('w="12700"')
    expect(line).toContain('cap="rnd"')
  })

  it('keeps a zero width distinct from an absent one', async () => {
    const source = packageWith(`<a:ln w="12700">${navy}</a:ln>`)
    const { document, shape } = await shapeOf(source)
    shape.strokeWidth = 0

    expect(lineOf(await slideXmlOf(await exportPptx(document, source)))).toContain('w="0"')
  })
})

describe('stroke dash writeback', () => {
  it('writes a changed dash style', async () => {
    const source = packageWith(`<a:ln w="12700">${navy}<a:prstDash val="dash"/></a:ln>`)
    const { document, shape } = await shapeOf(source)
    shape.strokeStyle = 'dot'

    expect(lineOf(await slideXmlOf(await exportPptx(document, source)))).toContain('<a:prstDash val="dot"/>')
  })

  /** `solid` never reaches the model, so clearing the style means removing the node. */
  it('removes the dash node when the model has no style', async () => {
    const source = packageWith(`<a:ln w="12700">${navy}<a:prstDash val="dash"/></a:ln>`)
    const { document, shape } = await shapeOf(source)
    delete shape.strokeStyle

    expect(lineOf(await slideXmlOf(await exportPptx(document, source)))).not.toContain('prstDash')
  })

  /** ECMA-376 orders the line's children fill first, then `prstDash`. */
  it('inserts the dash node after the fill when the source has none', async () => {
    const source = packageWith(`<a:ln w="12700">${navy}</a:ln>`)
    const { document, shape } = await shapeOf(source)
    shape.strokeStyle = 'dash'

    expect(lineOf(await slideXmlOf(await exportPptx(document, source))))
      .toBe(`<a:ln w="12700">${navy}<a:prstDash val="dash"/></a:ln>`)
  })

  /**
   * The model can only hold `dash` for a source `lgDashDot`, so the comparison collapses the source
   * token before comparing. Otherwise an unrelated edit would quietly downgrade the source's token.
   */
  it('leaves a collapsed source token alone when the style did not change', async () => {
    const source = packageWith(`<a:ln w="12700">${navy}<a:prstDash val="lgDashDot"/></a:ln>`)
    const { document, shape } = await shapeOf(source)
    expect(shape.strokeStyle).toBe('dash')
    shape.strokeWidth = 76200

    const line = lineOf(await slideXmlOf(await exportPptx(document, source)))

    expect(line).toContain('<a:prstDash val="lgDashDot"/>')
    expect(line).toContain('w="76200"')
  })

  it('still writes a real change away from a collapsed token', async () => {
    const source = packageWith(`<a:ln w="12700">${navy}<a:prstDash val="lgDashDot"/></a:ln>`)
    const { document, shape } = await shapeOf(source)
    shape.strokeStyle = 'dot'

    expect(lineOf(await slideXmlOf(await exportPptx(document, source)))).toContain('<a:prstDash val="dot"/>')
  })
})

describe('stroke writeback leaves untouched files alone', () => {
  /** Three independent comparisons means three chances to rewrite a file nobody edited. */
  it('stays byte-identical when nothing is edited', async () => {
    for (const line of [
      `<a:ln w="12700" cap="rnd">${navy}<a:prstDash val="dash"/></a:ln>`,
      `<a:ln>${navy}</a:ln>`,
      `<a:ln w="0">${navy}<a:prstDash val="sysDot"/></a:ln>`,
    ]) {
      const source = packageWith(line)

      expect(await exportPptx(await importPptx(source), source)).toEqual(source)
    }
  })

  it('writes colour, width and dash together while keeping unmodeled attributes', async () => {
    const source = packageWith(`<a:ln w="12700" cap="rnd" cmpd="sng">${navy}<a:prstDash val="dash"/></a:ln>`)
    const { document, shape } = await shapeOf(source)
    shape.stroke = { color: { type: 'srgb', v: 'FF0000' } }
    shape.strokeWidth = 38100
    shape.strokeStyle = 'dot'

    const line = lineOf(await slideXmlOf(await exportPptx(document, source)))

    expect(line).toContain('w="38100"')
    expect(line).toContain('cap="rnd"')
    expect(line).toContain('cmpd="sng"')
    expect(line).toContain('val="FF0000"')
    expect(line).toContain('<a:prstDash val="dot"/>')
  })

  /** A shape with no outline at all gains one carrying every modeled part. */
  it('builds a new line element with width and dash', async () => {
    const source = packageWith('')
    const { document, shape } = await shapeOf(source)
    shape.stroke = { color: { type: 'srgb', v: 'FF0000' } }
    shape.strokeWidth = 25400
    shape.strokeStyle = 'dash'

    expect(lineOf(await slideXmlOf(await exportPptx(document, source))))
      .toBe('<a:ln w="25400"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:prstDash val="dash"/></a:ln>')
  })
})

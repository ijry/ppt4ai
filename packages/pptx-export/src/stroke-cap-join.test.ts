import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

const navy = '<a:solidFill><a:srgbClr val="203864"/></a:solidFill>'

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

async function lineOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  const xml = new TextDecoder().decode(entries.get('ppt/slides/slide1.xml')!)
  return xml.slice(xml.indexOf('<a:ln'), xml.indexOf('</a:ln>') + 7)
}

async function shapeOf(source: Uint8Array) {
  const document = await importPptx(source)
  const shape = document.elements.el_1
  if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
  return { document, shape }
}

describe('stroke cap and join writeback', () => {
  /** Two more independent comparisons, so the unedited case is asserted across several line shapes. */
  it('stays byte-identical when nothing is edited', async () => {
    for (const line of [
      `<a:ln w="76200" cap="rnd">${navy}<a:bevel/></a:ln>`,
      `<a:ln w="76200">${navy}</a:ln>`,
      `<a:ln cap="sq">${navy}<a:miter lim="800000"/></a:ln>`,
    ]) {
      const source = packageWith(line)

      expect(await exportPptx(await importPptx(source), source)).toEqual(source)
    }
  })

  it('keeps the source cap and corner when only the width changes', async () => {
    const source = packageWith(`<a:ln w="76200" cap="rnd">${navy}<a:bevel/></a:ln>`)
    const { document, shape } = await shapeOf(source)
    shape.strokeWidth = 12700

    const line = await lineOf(await exportPptx(document, source))

    expect(line).toContain('cap="rnd"')
    expect(line).toContain('<a:bevel/>')
    expect(line).toContain('w="12700"')
  })

  it('writes a changed cap and corner', async () => {
    const source = packageWith(`<a:ln w="76200" cap="rnd">${navy}<a:bevel/></a:ln>`)
    const { document, shape } = await shapeOf(source)
    shape.strokeCap = 'sq'
    shape.strokeJoin = 'round'

    const line = await lineOf(await exportPptx(document, source))

    expect(line).toContain('cap="sq"')
    expect(line).toContain('<a:round/>')
    expect(line).not.toContain('bevel')
  })

  it('inserts a cap and corner the source lacks', async () => {
    const source = packageWith(`<a:ln w="76200">${navy}</a:ln>`)
    const { document, shape } = await shapeOf(source)
    shape.strokeCap = 'rnd'
    shape.strokeJoin = 'miter'

    // A newly added attribute is inserted right after the element name, so `cap` lands before the
    // existing `w`. XML attribute order carries no meaning, so the assertion does not pin it.
    const line = await lineOf(await exportPptx(document, source))
    expect(line).toContain('cap="rnd"')
    expect(line).toContain('w="76200"')
    expect(line).toContain('<a:miter/>')
  })

  /** The corner follows `prstDash` in the ECMA-376 sequence. */
  it('inserts the corner after the dash node', async () => {
    const source = packageWith(`<a:ln w="76200">${navy}<a:prstDash val="dash"/></a:ln>`)
    const { document, shape } = await shapeOf(source)
    shape.strokeJoin = 'bevel'

    expect(await lineOf(await exportPptx(document, source)))
      .toBe(`<a:ln w="76200">${navy}<a:prstDash val="dash"/><a:bevel/></a:ln>`)
  })

  it('removes a cap and corner the model no longer carries', async () => {
    const source = packageWith(`<a:ln w="76200" cap="rnd">${navy}<a:bevel/></a:ln>`)
    const { document, shape } = await shapeOf(source)
    delete shape.strokeCap
    delete shape.strokeJoin

    const line = await lineOf(await exportPptx(document, source))

    expect(line).not.toContain('cap=')
    expect(line).not.toContain('bevel')
    expect(line).toContain('w="76200"')
  })

  /** A miter whose limit the model cannot express is still replaced when the corner type changes. */
  it('replaces a miter corner and loses its unmodeled limit', async () => {
    const source = packageWith(`<a:ln w="76200">${navy}<a:miter lim="800000"/></a:ln>`)
    const { document, shape } = await shapeOf(source)
    shape.strokeJoin = 'round'

    const line = await lineOf(await exportPptx(document, source))

    expect(line).toContain('<a:round/>')
    expect(line).not.toContain('lim=')
  })
})

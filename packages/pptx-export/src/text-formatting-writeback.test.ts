import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="1" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

function slideWith(txBody: string): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Formatted"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr>'
    + `<p:txBody>${txBody}</p:txBody></p:sp>`
    + '</p:spTree></p:cSld></p:sld>'
}

function packageWith(txBody: string): Uint8Array {
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: new TextEncoder().encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode(slideWith(txBody)) },
  ])
}

const formattedBody = '<a:bodyPr/>'
  + '<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="3200" b="1" u="sng">'
  + '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:latin typeface="Georgia"/></a:rPr><a:t>Formatted</a:t></a:r></a:p>'

async function slideXmlOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  return new TextDecoder().decode(entries.get('ppt/slides/slide1.xml'))
}

async function importedText(bytes: Uint8Array) {
  const element = (await importPptx(bytes)).elements.el_1
  if (element?.kind !== 'text') throw new Error('fixture did not import as text')
  return element
}

describe('formatted text survives a writeback edit', () => {
  it('keeps run marks and paragraph attributes when the text changes', async () => {
    const source = packageWith(formattedBody)
    const document = await importPptx(source)
    const text = document.elements.el_1
    if (text?.kind !== 'text') throw new Error('fixture did not import as text')
    const paragraph = text.body?.paragraphs[0]
    if (!paragraph) throw new Error('fixture paragraph is missing')
    text.body = { paragraphs: [{ ...paragraph, runs: [{ text: 'Edited', ...(paragraph.runs[0]?.marks ? { marks: paragraph.runs[0].marks } : {}) }] }] }

    const output = await exportPptx(document, source)
    const outputSlide = await slideXmlOf(output)

    expect(outputSlide).toContain('Edited')
    expect(outputSlide).toContain('typeface="Georgia"')
    expect(outputSlide).toContain('sz="3200"')
    expect(outputSlide).toContain('algn="ctr"')
    expect((await importedText(output)).body?.paragraphs[0]).toEqual({
      attrs: { align: 'center' },
      runs: [{
        text: 'Edited',
        marks: { fontFamily: 'Georgia', fontSize: 32, bold: true, underline: 'single', color: { color: { type: 'srgb', v: 'FF0000' } } },
      }],
    })
  })

  it('writes a marks-only edit, which text-content comparison used to skip', async () => {
    const source = packageWith(formattedBody)
    const document = await importPptx(source)
    const text = document.elements.el_1
    if (text?.kind !== 'text') throw new Error('fixture did not import as text')
    text.body = { paragraphs: [{ runs: [{ text: 'Formatted', marks: { fontFamily: 'Verdana' } }] }] }

    const output = await exportPptx(document, source)

    expect(await slideXmlOf(output)).toContain('typeface="Verdana"')
    expect((await importedText(output)).body?.paragraphs[0]?.runs[0]?.marks).toEqual({ fontFamily: 'Verdana' })
  })

  it('writes a paragraph-attribute-only edit', async () => {
    const source = packageWith(formattedBody)
    const document = await importPptx(source)
    const text = document.elements.el_1
    if (text?.kind !== 'text') throw new Error('fixture did not import as text')
    const paragraph = text.body?.paragraphs[0]
    if (!paragraph) throw new Error('fixture paragraph is missing')
    paragraph.attrs = { align: 'right' }

    expect(await slideXmlOf(await exportPptx(document, source))).toContain('algn="r"')
  })

  it('leaves the package byte-identical when nothing is edited', async () => {
    const source = packageWith(formattedBody)
    const document = await importPptx(source)

    expect(await exportPptx(document, source)).toEqual(source)
  })

  it('does not rewrite txBody when an unrelated field changes', async () => {
    const source = packageWith(formattedBody)
    const document = await importPptx(source)
    const text = document.elements.el_1
    if (text?.kind !== 'text') throw new Error('fixture did not import as text')
    text.bounds = { ...text.bounds, x: 2000000 }

    const outputSlide = await slideXmlOf(await exportPptx(document, source))

    // The source rPr is preserved verbatim rather than re-serialized from the model.
    expect(outputSlide).toContain('<a:rPr sz="3200" b="1" u="sng">')
    expect(outputSlide).toContain('<a:off x="2000000" y="1000000"/>')
  })

  it('drops formatting the model no longer carries', async () => {
    const source = packageWith(formattedBody)
    const document = await importPptx(source)
    const text = document.elements.el_1
    if (text?.kind !== 'text') throw new Error('fixture did not import as text')
    text.body = { paragraphs: [{ runs: [{ text: 'Formatted' }] }] }

    const outputSlide = await slideXmlOf(await exportPptx(document, source))

    // Clearing marks is a real edit, not a no-op: the model is the source of truth once it differs.
    expect(outputSlide).not.toContain('typeface="Georgia"')
    expect(outputSlide).toContain('<a:t>Formatted</a:t>')
  })
})

const geometryBody = '<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>'
  + '<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>'

describe('geometry on a shape that carries text', () => {
  function styledShapePackage(): Uint8Array {
    const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
      + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Rounded"/><p:nvPr/></p:nvSpPr>'
      + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
      + `${geometryBody}</p:spPr>`
      + '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Label</a:t></a:r></a:p></p:txBody></p:sp>'
      + '</p:spTree></p:cSld></p:sld>'
    return writeStoredZip([
      { name: 'ppt/presentation.xml', data: new TextEncoder().encode(presentation) },
      { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode(presentationRels) },
      { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode(slide) },
    ])
  }

  /** Reading the preset must not make the exporter think the geometry changed. */
  it('leaves the package byte-identical when nothing is edited', async () => {
    const source = styledShapePackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  /** `<p:style>` is a sibling of `spPr`, so range writeback must never touch it. */
  it('leaves a p:style block untouched when the text changes', async () => {
    const styleBlock = '<p:style><a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef>'
      + '<a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef>'
      + '<a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>'
      + '<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>'
    const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
      + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Styled"/><p:nvPr/></p:nvSpPr>'
      + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
      + '<a:prstGeom prst="rect"/></p:spPr>'
      + styleBlock
      + '<p:txBody><a:bodyPr/><a:p><a:r><a:t>Label</a:t></a:r></a:p></p:txBody></p:sp>'
      + '</p:spTree></p:cSld></p:sld>'
    const source = writeStoredZip([
      { name: 'ppt/presentation.xml', data: new TextEncoder().encode(presentation) },
      { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode(presentationRels) },
      { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode(slide) },
    ])
    const document = await importPptx(source)
    expect(await exportPptx(document, source)).toEqual(source)

    const text = document.elements.el_1
    if (text?.kind !== 'text') throw new Error('fixture did not import as text')
    text.body = { paragraphs: [{ runs: [{ text: 'Edited' }] }] }

    expect(await slideXmlOf(await exportPptx(document, source))).toContain(styleBlock)
  })

  it('keeps the geometry when the text changes', async () => {
    const source = styledShapePackage()
    const document = await importPptx(source)
    const text = document.elements.el_1
    if (text?.kind !== 'text') throw new Error('fixture did not import as text')
    text.body = { paragraphs: [{ runs: [{ text: 'Edited' }] }] }

    const output = await exportPptx(document, source)

    expect(await slideXmlOf(output)).toContain('<a:prstGeom prst="roundRect">')
    expect((await importedText(output)).preset).toBe('roundRect')
  })
})

/** Reading the width must not make the exporter rewrite the line, and a colour edit must keep it. */
describe('stroke width survives a writeback edit', () => {
  function outlinedPackage(): Uint8Array {
    const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
      + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Outlined"/><p:nvPr/></p:nvSpPr>'
      + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
      + '<a:prstGeom prst="rect"/><a:ln w="76200" cap="rnd"><a:solidFill><a:srgbClr val="203864"/></a:solidFill></a:ln>'
      + '</p:spPr></p:sp></p:spTree></p:cSld></p:sld>'
    return writeStoredZip([
      { name: 'ppt/presentation.xml', data: new TextEncoder().encode(presentation) },
      { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode(presentationRels) },
      { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode(slide) },
    ])
  }

  it('leaves the package byte-identical when nothing is edited', async () => {
    const source = outlinedPackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  it('keeps the width and unknown line attributes when the colour changes', async () => {
    const source = outlinedPackage()
    const document = await importPptx(source)
    const shape = document.elements.el_1
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    expect(shape.strokeWidth).toBe(76200)
    shape.stroke = { color: { type: 'srgb', v: 'FF0000' } }

    const outputSlide = await slideXmlOf(await exportPptx(document, source))

    expect(outputSlide).toContain('<a:ln w="76200" cap="rnd">')
    expect(outputSlide).toContain('val="FF0000"')
  })
})

/** The dash style is read but never written back, so the source node has to survive untouched. */
describe('stroke dash survives a writeback edit', () => {
  function dashedPackage(): Uint8Array {
    const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
      + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Dashed"/><p:nvPr/></p:nvSpPr>'
      + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
      + '<a:prstGeom prst="rect"/><a:ln w="76200"><a:solidFill><a:srgbClr val="203864"/></a:solidFill>'
      + '<a:prstDash val="lgDashDot"/></a:ln>'
      + '</p:spPr></p:sp></p:spTree></p:cSld></p:sld>'
    return writeStoredZip([
      { name: 'ppt/presentation.xml', data: new TextEncoder().encode(presentation) },
      { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode(presentationRels) },
      { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode(slide) },
    ])
  }

  it('leaves the package byte-identical when nothing is edited', async () => {
    const source = dashedPackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  /** The model now carries `lgDashDot` itself, so recolouring an outline cannot downgrade its token. */
  it('keeps the source dash token when the colour changes', async () => {
    const source = dashedPackage()
    const document = await importPptx(source)
    const shape = document.elements.el_1
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    expect(shape.strokeStyle).toBe('lgDashDot')
    shape.stroke = { color: { type: 'srgb', v: 'FF0000' } }

    const outputSlide = await slideXmlOf(await exportPptx(document, source))

    expect(outputSlide).toContain('<a:prstDash val="lgDashDot"/>')
    expect(outputSlide).not.toContain('val="dash"')
    expect(outputSlide).toContain('val="FF0000"')
  })
})
const scriptBody = '<a:bodyPr/><a:p><a:r><a:rPr sz="2400">'
  + '<a:latin typeface="Calibri"/><a:ea typeface="宋体"/><a:cs typeface="Arial"/>'
  + '</a:rPr><a:t>Hello 你好</a:t></a:r></a:p>'

describe('per-script typefaces survive a writeback edit', () => {
  it('leaves the package byte-identical when nothing is edited', async () => {
    const source = packageWith(scriptBody)
    const document = await importPptx(source)

    expect(await exportPptx(document, source)).toEqual(source)
  })

  /**
   * The gap this closes: editing the text replaces the whole `txBody`, and the serializer used to
   * write only `<a:latin>` — so a Chinese run lost its typeface the first time anyone touched it.
   */
  it('keeps the east asian and complex typefaces when the text changes', async () => {
    const source = packageWith(scriptBody)
    const document = await importPptx(source)
    const text = document.elements.el_1
    if (text?.kind !== 'text') throw new Error('fixture did not import as text')
    const marks = text.body?.paragraphs[0]?.runs[0]?.marks
    text.body = { paragraphs: [{ runs: [{ text: '再见 bye', ...(marks ? { marks } : {}) }] }] }

    const output = await exportPptx(document, source)
    const outputSlide = await slideXmlOf(output)

    expect(outputSlide).toContain('<a:latin typeface="Calibri"/><a:ea typeface="宋体"/><a:cs typeface="Arial"/>')
    expect((await importedText(output)).body?.paragraphs[0]?.runs[0]?.marks).toEqual({
      fontFamily: 'Calibri',
      fontFamilyEa: '宋体',
      fontFamilyCs: 'Arial',
      fontSize: 24,
    })
  })
})

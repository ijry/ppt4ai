import type { Ppt4aiDocument, TextBody } from '@ppt4ai/model'
import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx, rewriteLayoutXml, rewriteMasterXml } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const partPaths = {
  slide: 'ppt/slides/slide1.xml',
  layout: 'ppt/slideLayouts/slideLayout1.xml',
  master: 'ppt/slideMasters/slideMaster1.xml',
} as const
type Target = keyof typeof partPaths
const targets: Target[] = ['slide', 'layout', 'master']
const namespaces = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
  + ' xmlns:q="http://schemas.openxmlformats.org/presentationml/2006/main"'
  + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
  + ' xmlns:d="http://schemas.openxmlformats.org/drawingml/2006/main"'
  + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const paragraph = '<a:p><a:r><a:t>Original</a:t></a:r></a:p>'
const changedParagraph = '<a:p><a:r><a:t>Edited</a:t></a:r></a:p>'
const listStyle = '<a:lstStyle data-list="keep"><a:lvl1pPr><a:defRPr sz="2400"/></a:lvl1pPr></a:lstStyle>'
const warp = '<a:prstTxWarp prst="textArchUp"><a:avLst/></a:prstTxWarp>'
const autofit = "<a:normAutofit fontScale='90000' lnSpcReduction='10000'/>"
const scene = '<a:scene3d data-scene="keep"/>'
const propertyExtension = '<a:extLst data-properties="keep"/>'
const properties = "<a:bodyPr rot='600000' vert='vert270' anchor='t' wrap='square' lIns='1234'>"
  + warp + autofit + scene + propertyExtension + '</a:bodyPr>'
const preservedParagraph = '<a:p data-paragraph="keep"><a:r><a:rPr lang="en-US">'
  + '<a:hlinkClick r:id="rId9"/></a:rPr><a:t>Original</a:t></a:r>'
  + '<a:fld id="{A1}" type="slidenum"><a:rPr lang="en-US"/><a:t>7</a:t></a:fld>'
  + '<a:endParaRPr lang="zh-CN"/></a:p>'

function txBody(bodyProperties: string, paragraphs = paragraph): string {
  return '<p:txBody xmlns:u="urn:unmodeled" data-body="keep">'
    + bodyProperties + '<!--list settings stay in the source-->' + listStyle + paragraphs
    + '<u:extra data-body-child="keep"/></p:txBody>'
}

function partXml(target: Target, body: string): string {
  const root = target === 'slide' ? 'sld' : target === 'layout' ? 'sldLayout' : 'sldMaster'
  return '<p:' + root + ' ' + namespaces + '><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm></p:spPr>'
    + body + '</p:sp></p:spTree></p:cSld></p:' + root + '>'
}

function sourcePackage(body: string): Uint8Array {
  const relationship = (type: string, target: string) => '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + type
    + '" Target="' + target + '"/></Relationships>'
  const entries: Array<[string, string]> = [
    ['ppt/presentation.xml', '<p:presentation ' + namespaces + '><p:sldSz cx="12192000" cy="6858000"/>'
      + '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'],
    ['ppt/_rels/presentation.xml.rels', relationship('slide', 'slides/slide1.xml')],
    ['ppt/slides/_rels/slide1.xml.rels', relationship('slideLayout', '../slideLayouts/slideLayout1.xml')],
    ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', relationship('slideMaster', '../slideMasters/slideMaster1.xml')],
    ...targets.map((target): [string, string] => [partPaths[target], partXml(target, body)]),
  ]
  return writeStoredZip(entries.map(([name, value]) => ({ name, data: new TextEncoder().encode(value) })))
}

function editableBody(document: Ppt4aiDocument, target: Target): TextBody {
  const element = document.elements.el_1
  const body = target === 'slide' ? (element?.kind === 'text' ? element.body : undefined)
    : target === 'layout' ? document.layouts?.lyt_1?.defaults?.title?.body
      : document.masters?.mst_1?.defaults?.title?.body
  if (!body) throw new Error('fixture text body is missing: ' + target)
  return body
}

async function partOf(bytes: Uint8Array, target: Target): Promise<string> {
  const entry = (await readZipEntries(bytes)).find((entry) => entry.name === partPaths[target])
  if (!entry) throw new Error('fixture part is missing: ' + target)
  return new TextDecoder().decode(entry.data)
}

async function fixture(xml: string, target: Target = 'slide') {
  const source = sourcePackage(xml)
  const document = await importPptx(source)
  return { source, document, body: editableBody(document, target) }
}

describe('a text body is patched without rebuilding its unedited parts', () => {
  // Reverting either writeback to whole-txBody serialization loses the headers and u:extra here.
  it.each(targets)('keeps the %s body settings, list style and unknown children when only text changes', async (target) => {
    const original = txBody(properties)
    const { source, document, body } = await fixture(original, target)
    body.paragraphs[0]!.runs[0]!.text = 'Edited'

    const output = await exportPptx(document, source)

    expect(await partOf(output, target)).toBe(partXml(target, original.replace(paragraph, changedParagraph)))
    for (const untouched of targets.filter((other) => other !== target)) {
      expect(await partOf(output, untouched)).toBe(partXml(untouched, original))
    }
  })

  // Comparing raw vert/insets instead of normalized model values would rewrite vert270 or lIns.
  it.each(targets)('patches only the changed %s attribute and leaves its paragraphs byte-identical', async (target) => {
    const original = txBody(properties, preservedParagraph)
    const { source, document, body } = await fixture(original, target)
    body.bodyPr!.verticalAlign = 'bottom'

    const output = await exportPptx(document, source)

    expect(await partOf(output, target)).toBe(partXml(target, original.replace("anchor='t'", "anchor='b'")))
    expect(editableBody(await importPptx(output), target).bodyPr?.verticalAlign).toBe('bottom')
  })

  it('patches the shrink scale without losing the other autofit attributes or siblings', async () => {
    const original = txBody(properties, preservedParagraph)
    const { source, document, body } = await fixture(original)
    body.bodyPr!.autofit = { type: 'shrink', minFontScale: 80000 }

    const output = await exportPptx(document, source)

    expect(await partOf(output, 'slide')).toBe(partXml('slide', original.replace("fontScale='90000'", "fontScale='80000'")))
    expect(editableBody(await importPptx(output), 'slide').bodyPr?.autofit).toEqual({ type: 'shrink', minFontScale: 80000 })
  })

  it('removes a cleared shrink scale but keeps the source-only line-spacing reduction', async () => {
    const original = txBody(properties)
    const { source, document, body } = await fixture(original)
    body.bodyPr!.autofit = { type: 'shrink' }

    expect(await partOf(await exportPptx(document, source), 'slide')).toBe(
      partXml('slide', original.replace(" fontScale='90000'", '')),
    )
  })

  it.each([
    { type: 'none', xml: '<a:noAutofit/>' },
    { type: 'resize', xml: '<a:spAutoFit/>' },
  ] as const)('replaces only the autofit choice when switching to $type', async ({ type, xml }) => {
    const original = txBody(properties, preservedParagraph)
    const { source, document, body } = await fixture(original)
    body.bodyPr!.autofit = { type }

    const output = await exportPptx(document, source)

    expect(await partOf(output, 'slide')).toBe(partXml('slide', original.replace(autofit, xml)))
    expect(editableBody(await importPptx(output), 'slide').bodyPr?.autofit).toEqual({ type })
  })

  it('inserts autofit after the text warp and before 3D settings', async () => {
    const original = txBody(properties.replace(autofit, ''), preservedParagraph)
    const { source, document, body } = await fixture(original)
    body.bodyPr!.autofit = { type: 'shrink', minFontScale: 75000 }

    expect(await partOf(await exportPptx(document, source), 'slide')).toBe(
      partXml('slide', original.replace(scene, '<a:normAutofit fontScale="75000"/>' + scene)),
    )
  })

  it('removes explicitly cleared modeled properties without clearing the rest of bodyPr', async () => {
    const before = "<a:bodyPr rot='600000' lIns='1' tIns='2' rIns='3' bIns='4' anchor='t' vert='horz' wrap='none'>"
      + warp + autofit + scene + propertyExtension + '</a:bodyPr>'
    const after = "<a:bodyPr rot='600000'>" + warp + scene + propertyExtension + '</a:bodyPr>'
    const original = txBody(before, preservedParagraph)
    const { source, document, body } = await fixture(original)
    delete body.bodyPr

    const output = await exportPptx(document, source)

    expect(await partOf(output, 'slide')).toBe(partXml('slide', original.replace(before, after)))
    expect(editableBody(await importPptx(output), 'slide').bodyPr).toBeUndefined()
  })

  it('changes one inset without normalizing the other inset spellings', async () => {
    const before = "<a:bodyPr lIns='1.0' tIns='2.0' rIns='3.0' bIns='4.0' rot='600000'/>"
    const original = txBody(before, preservedParagraph)
    const { source, document, body } = await fixture(original)
    body.bodyPr!.insets!.left = 42

    expect(await partOf(await exportPptx(document, source), 'slide')).toBe(
      partXml('slide', original.replace("lIns='1.0'", "lIns='42'")),
    )
  })

  it('expands a self-closing bodyPr while applying attribute and autofit edits together', async () => {
    const before = "<a:bodyPr anchor='t' data-empty='keep'/>"
    const after = "<a:bodyPr anchor='b' data-empty='keep'><a:normAutofit fontScale=\"85000\"/></a:bodyPr>"
    const original = txBody(before, preservedParagraph)
    const { source, document, body } = await fixture(original)
    body.bodyPr = { verticalAlign: 'bottom', autofit: { type: 'shrink', minFontScale: 85000 } }

    expect(await partOf(await exportPptx(document, source), 'slide')).toBe(partXml('slide', original.replace(before, after)))
  })

  it('can add attributes and autofit at the same closing-slash offset of a bare bodyPr', async () => {
    const original = txBody('<a:bodyPr/>', preservedParagraph)
    const { source, document, body } = await fixture(original)
    body.bodyPr = { wrap: 'none', verticalAlign: 'bottom', autofit: { type: 'none' } }

    const output = await exportPptx(document, source)

    expect(await partOf(output, 'slide')).toBe(partXml('slide', original.replace(
      '<a:bodyPr/>', '<a:bodyPr wrap="none" anchor="b"><a:noAutofit/></a:bodyPr>',
    )))
    expect(editableBody(await importPptx(output), 'slide').bodyPr).toEqual({ wrap: 'none', verticalAlign: 'bottom', autofit: { type: 'none' } })
  })

  it('inserts missing bodyPr before the existing list style and paragraphs', async () => {
    const original = txBody('', preservedParagraph)
    const { source, document, body } = await fixture(original)
    body.bodyPr = { wrap: 'none', autofit: { type: 'none' } }

    const output = await exportPptx(document, source)
    const xml = await partOf(output, 'slide')

    expect(xml).toContain('<a:bodyPr wrap="none"><a:noAutofit/></a:bodyPr>')
    expect(xml.indexOf('<a:bodyPr')).toBeLessThan(xml.indexOf('<a:lstStyle'))
    expect(xml).toContain(listStyle)
    expect(xml).toContain(preservedParagraph)
    expect(editableBody(await importPptx(output), 'slide').bodyPr).toEqual({ wrap: 'none', autofit: { type: 'none' } })
  })

  it('does not rewrite an untouched paragraph when a later paragraph changes', async () => {
    const original = txBody(properties, preservedParagraph + '<!--between paragraphs-->' + paragraph)
    const { source, document, body } = await fixture(original)
    body.paragraphs[1]!.runs[0]!.text = 'Edited'

    expect(await partOf(await exportPptx(document, source), 'slide')).toBe(
      partXml('slide', original.replace(paragraph, changedParagraph)),
    )
  })

  it('adds paragraphs before trailing unknown children', async () => {
    const original = txBody(properties)
    const { source, document, body } = await fixture(original)
    body.paragraphs.push({ runs: [{ text: 'Added' }] })
    const added = '<a:p><a:r><a:t>Added</a:t></a:r></a:p>'

    expect(await partOf(await exportPptx(document, source), 'slide')).toBe(
      partXml('slide', original.replace(paragraph, paragraph + added)),
    )
  })

  it('removes paragraphs without removing interleaved unknown siblings', async () => {
    const second = '<a:p><a:r><a:t>Remove me</a:t></a:r></a:p>'
    const original = txBody(properties, paragraph + '<u:between/>' + second)
    const { source, document, body } = await fixture(original)
    body.paragraphs.pop()

    expect(await partOf(await exportPptx(document, source), 'slide')).toBe(partXml('slide', original.replace(second, '')))
  })

  it('writes one empty paragraph when the model clears every paragraph', async () => {
    const original = txBody(properties)
    const { source, document, body } = await fixture(original)
    body.paragraphs = []

    expect(await partOf(await exportPptx(document, source), 'slide')).toBe(partXml('slide', original.replace(paragraph, '<a:p/>')))
  })

  it.each(targets)('uses the source %s namespace prefixes when writing changed content', async (target) => {
    const original = txBody(properties).replaceAll('p:txBody', 'q:txBody').replaceAll('<a:', '<d:').replaceAll('</a:', '</d:')
    const { source, document, body } = await fixture(original, target)
    body.paragraphs[0]!.runs[0]!.text = 'Edited'
    body.bodyPr!.autofit = { type: 'resize' }

    expect(await partOf(await exportPptx(document, source), target)).toBe(partXml(target,
      original.replace('<d:t>Original</d:t>', '<d:t>Edited</d:t>')
        .replace(autofit.replace('<a:', '<d:'), '<d:spAutoFit/>'),
    ))
  })

  it.each([
    { opening: '<x:p xmlns:x="http://schemas.openxmlformats.org/drawingml/2006/main">', prefix: 'x:' },
    { opening: '<p xmlns="http://schemas.openxmlformats.org/drawingml/2006/main">', prefix: '' },
  ])('keeps a paragraph-local namespace declaration for $prefix content', async ({ opening, prefix }) => {
    const localParagraph = opening + '<' + prefix + 'r><' + prefix + 't>Original</' + prefix + 't></' + prefix + 'r></' + prefix + 'p>'
    const original = txBody(properties, localParagraph)
    const { source, document, body } = await fixture(original)
    body.paragraphs[0]!.runs[0]!.text = 'Edited'

    expect(await partOf(await exportPptx(document, source), 'slide')).toBe(
      partXml('slide', original.replace('>Original<', '>Edited<')),
    )
  })

  it('carries a paragraph-local prefix binding onto newly appended paragraphs', async () => {
    const opening = '<x:p xmlns:x="http://schemas.openxmlformats.org/drawingml/2006/main">'
    const localParagraph = opening + '<x:r><x:t>Original</x:t></x:r></x:p>'
    const original = txBody(properties, localParagraph)
    const { source, document, body } = await fixture(original)
    body.paragraphs.push({ runs: [{ text: 'Added' }] })
    const added = opening + '<x:r><x:t>Added</x:t></x:r></x:p>'

    expect(await partOf(await exportPptx(document, source), 'slide')).toBe(
      partXml('slide', original.replace(localParagraph, localParagraph + added)),
    )
  })

  it('keeps an autofit-local namespace declaration when replacing its choice', async () => {
    const localAutofit = '<x:normAutofit xmlns:x="http://schemas.openxmlformats.org/drawingml/2006/main" fontScale="90000"/>'
    const original = txBody(properties.replace(autofit, localAutofit))
    const { source, document, body } = await fixture(original)
    body.bodyPr!.autofit = { type: 'resize' }

    expect(await partOf(await exportPptx(document, source), 'slide')).toBe(partXml('slide',
      original.replace(localAutofit, '<x:spAutoFit xmlns:x="http://schemas.openxmlformats.org/drawingml/2006/main"/>'),
    ))
  })

  it('binds a prefix borrowed from a paragraph when inserting missing bodyPr', async () => {
    const localParagraph = '<x:p xmlns:x="http://schemas.openxmlformats.org/drawingml/2006/main"><x:r><x:t>Original</x:t></x:r></x:p>'
    const original = '<p:txBody>' + localParagraph + '</p:txBody>'
    const { source, document, body } = await fixture(original)
    body.bodyPr = { wrap: 'none' }

    expect(await partOf(await exportPptx(document, source), 'slide')).toBe(partXml('slide',
      '<p:txBody><x:bodyPr xmlns:x="http://schemas.openxmlformats.org/drawingml/2006/main" wrap="none"/>' + localParagraph + '</p:txBody>',
    ))
  })

  it('leaves the whole body untouched during an unrelated bounds edit', async () => {
    const original = txBody(properties, preservedParagraph)
    const { source, document } = await fixture(original)
    document.elements.el_1!.bounds.x = 2000000

    expect(await partOf(await exportPptx(document, source), 'slide')).toContain(original)
  })
})

describe.each([
  { target: 'master' as const, rewrite: rewriteMasterXml },
  { target: 'layout' as const, rewrite: rewriteLayoutXml },
])('placeholder $target text-only edits', ({ target, rewrite }) => {
  it('preserves existing body properties when only the legacy text field is supplied', () => {
    const original = txBody(properties)
    const source = partXml(target, original)

    expect(rewrite(source, { title: { text: 'Edited' } }, undefined, 'part_1')).toBe(
      partXml(target, original.replace(paragraph, changedParagraph)),
    )
  })

  it('fills an empty self-closing txBody without losing its opening attributes', () => {
    const original = '<p:txBody data-empty="keep"/>'
    const output = rewrite(partXml(target, original), { title: { body: { paragraphs: [{ runs: [{ text: 'Edited' }] }] } } }, undefined, 'part_1')

    expect(output).toContain('<p:txBody data-empty="keep">')
    expect(output).toContain('<a:bodyPr/>')
    expect(output).toContain(changedParagraph)
    expect(output).toContain('</p:txBody>')
  })
})

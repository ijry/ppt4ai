import { resolveStyleLine, resolveStyleLineStroke, type Ppt4aiDocument, type ThemeLineStyle, type ThemeLineStyleEntry } from '@ppt4ai/model'
import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { createPptx, exportPptx, rewriteThemeXml } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const drawingNamespace = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const solid = "<d:solidFill data-fill='keep'><d:schemeClr val='phClr'/><d:extLst data-fill-ext='keep'/></d:solidFill>"
const explicitSolid = "<d:prstDash val='solid' data-dash='keep'/>"
const miter = "<d:miter lim='0400000' data-join='keep'/>"
const arrows = "<d:headEnd type='triangle' w='med' len='lg'/><d:tailEnd type='oval'/>"
const extension = "<d:extLst data-line-ext='keep'/>"
const firstLine = "<d:ln w='012700' cap='rnd' cmpd='dbl' algn='ctr' data-line='keep'>" + solid + explicitSolid + miter + arrows + extension + '</d:ln>'
const stops = "<d:gsLst><d:gs pos='0'><d:schemeClr val='phClr'/></d:gs><d:gs pos='100000'><d:srgbClr val='FF0000'/></d:gs></d:gsLst>"
const axis = "<d:lin ang='05400000' scaled='false'/>"
const gradient = "<d:gradFill rotWithShape='1'>" + stops + axis + "<d:tileRect l='10000'/><d:extLst data-gradient='keep'/></d:gradFill>"
const customDash = "<d:custDash data-custom='keep'><d:ds d='0400000' sp='0200000'/><d:ds d='bad' sp='100000'/></d:custDash>"
const secondLine = "<d:ln w='19050' cap='flat'>" + gradient + customDash + '<d:round/>' + arrows + extension + '</d:ln>'
const pattern = "<d:pattFill prst='pct10' data-pattern='keep'><d:fgClr><d:schemeClr val='phClr'/></d:fgClr><d:bgClr><d:srgbClr val='FFFFFF'/></d:bgClr></d:pattFill>"
const thirdLine = '<d:ln>' + pattern + extension + '</d:ln>'
const picture = "<d:ln w='6350' data-picture='keep'><d:blipFill><d:blip r:embed='rId9'/></d:blipFill>" + arrows + '</d:ln>'
const unknown = '<x:unknownLine data-unknown="keep"/>'
const noFill = "<d:ln w='6350' cap='sq' data-empty='keep'><d:noFill/>" + arrows + extension + '</d:ln>'
const lastLine = '<d:ln data-last="keep"><d:solidFill><d:srgbClr val="112233"/></d:solidFill></d:ln>'
const linesXml = [firstLine, secondLine, thirdLine, picture, unknown, noFill, lastLine].join('<!--between slots-->')
const fillList = '<d:fillStyleLst><d:solidFill><d:schemeClr val="phClr"/></d:solidFill></d:fillStyleLst>'
const effectList = '<d:effectStyleLst><d:effectStyle><d:effectLst><d:glow rad="63500"><d:srgbClr val="FF0000"/></d:glow></d:effectLst></d:effectStyle></d:effectStyleLst>'

function themeXml(lines = linesXml): string {
  return '<d:theme xmlns:d="' + drawingNamespace + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:x="urn:unknown">'
    + '<d:themeElements><d:clrScheme name="Custom"><d:accent1><d:srgbClr val="4472C4"/></d:accent1></d:clrScheme><d:fontScheme name="Custom"/>'
    + '<d:fmtScheme name="Custom">' + fillList + '<d:lnStyleLst data-list="keep">' + lines + '</d:lnStyleLst>'
    + effectList + '<d:bgFillStyleLst/></d:fmtScheme></d:themeElements></d:theme>'
}

const baseDocument: Ppt4aiDocument = {
  format: 'ppt4ai', version: 1, id: 'line-writeback', page: { w: 12192000, h: 6858000 },
  slides: { sld_1: { id: 'sld_1', elementIds: ['shape_1'], layoutId: 'lyt_1' } }, slideOrder: ['sld_1'],
  layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } }, masters: { mst_1: { id: 'mst_1', themeId: 'theme_1' } },
  themes: { theme_1: { id: 'theme_1', colors: {} } },
  elements: { shape_1: { id: 'shape_1', kind: 'shape', preset: 'rect', bounds: { x: 1000000, y: 1000000, w: 2000000, h: 1000000 },
    styleRef: { line: { idx: 1, color: { type: 'scheme', v: 'accent1' } }, fill: { idx: 0 }, effect: { idx: 0 }, font: { idx: 'minor' } },
  } },
}

async function fixture(xml = themeXml()) {
  const parts = await readZipEntries(await createPptx(baseDocument))
  const part = parts.find((entry) => entry.name === 'ppt/theme/theme1.xml')!
  part.data = new TextEncoder().encode(xml)
  const source = writeStoredZip(parts)
  const document = await importPptx(source)
  const theme = Object.values(document.themes ?? {})[0]!
  const lines = theme.formatScheme?.lineStyles
  if (!lines) throw new Error('fixture line styles are missing')
  return { source, document, theme, lines }
}

function lineAt(lines: ThemeLineStyleEntry[], index = 0): ThemeLineStyle {
  const line = lines[index]
  if (!line) throw new Error('fixture line is missing: ' + index)
  return line
}

async function themeOf(bytes: Uint8Array): Promise<string> {
  const part = (await readZipEntries(bytes)).find((entry) => entry.name === 'ppt/theme/theme1.xml')
  if (!part) throw new Error('exported theme is missing')
  return new TextDecoder().decode(part.data)
}

async function linesOf(bytes: Uint8Array): Promise<ThemeLineStyleEntry[]> {
  const lines = Object.values((await importPptx(bytes)).themes ?? {})[0]?.formatScheme?.lineStyles
  if (!lines) throw new Error('reimported lines are missing')
  return lines
}

describe('theme line properties use semantic comparisons and local patches', () => {
  // A whole-line replacement would discard the arrow/extension/explicit-solid bytes in every case.
  it.each([
    { key: 'width', value: 25400, before: "w='012700'", after: "w='25400'" },
    { key: 'width', value: 0, before: "w='012700'", after: "w='0'" },
    { key: 'cap', value: 'sq', before: "cap='rnd'", after: "cap='sq'" },
    { key: 'compound', value: 'tri', before: "cmpd='dbl'", after: "cmpd='tri'" },
    { key: 'align', value: 'in', before: "algn='ctr'", after: "algn='in'" },
    { key: 'miterLimit', value: 800000, before: "lim='0400000'", after: "lim='800000'" },
  ] as const)('patches only $key to $value and keeps source spelling elsewhere', async ({ key, value, before, after }) => {
    const { source, document, lines } = await fixture()
    Object.assign(lineAt(lines), { [key]: value })

    const output = await exportPptx(document, source)

    expect(await themeOf(output)).toBe(themeXml().replace(before, after))
    expect(lineAt(await linesOf(output))[key]).toBe(value)
  })

  it.each([
    { key: 'width', attribute: " w='012700'" }, { key: 'cap', attribute: " cap='rnd'" },
    { key: 'compound', attribute: " cmpd='dbl'" }, { key: 'align', attribute: " algn='ctr'" },
    { key: 'miterLimit', attribute: " lim='0400000'" },
  ] as const)('removes a cleared $key rather than leaving its old value behind', async ({ key, attribute }) => {
    const { source, document, lines } = await fixture()
    delete lineAt(lines)[key]
    const output = await exportPptx(document, source)
    expect(await themeOf(output)).toBe(themeXml().replace(attribute, ''))
    expect(lineAt(await linesOf(output))[key]).toBeUndefined()
  })

  it('changes a preset dash token in place, preserving that node\'s own attributes', async () => {
    const { source, document, lines } = await fixture()
    lineAt(lines).style = 'lgDashDot'
    const output = await exportPptx(document, source)
    expect(await themeOf(output)).toBe(themeXml().replace("val='solid'", "val='lgDashDot'"))
    expect(lineAt(await linesOf(output)).style).toBe('lgDashDot')
  })

  it('switches a preset dash to custom segments without moving the following join', async () => {
    const { source, document, lines } = await fixture()
    lineAt(lines).style = { custom: [{ dash: 400000, space: 200000 }] }
    const output = await exportPptx(document, source)
    expect(await themeOf(output)).toBe(themeXml().replace(explicitSolid, '<d:custDash><d:ds d="400000" sp="200000"/></d:custDash>'))
    expect(lineAt(await linesOf(output)).style).toEqual({ custom: [{ dash: 400000, space: 200000 }] })
  })

  it('switches custom segments to a preset, removing the old choice', async () => {
    const { source, document, lines } = await fixture()
    lineAt(lines, 1).style = 'sysDot'
    const output = await exportPptx(document, source)
    expect(await themeOf(output)).toBe(themeXml().replace(customDash, '<d:prstDash val="sysDot"/>'))
    expect(lineAt(await linesOf(output), 1).style).toBe('sysDot')
  })

  it('replaces changed custom segments while leaving gradient and arrows alone', async () => {
    const { source, document, lines } = await fixture()
    lineAt(lines, 1).style = { custom: [{ dash: 800000, space: 300000 }] }
    const output = await exportPptx(document, source)
    expect(await themeOf(output)).toBe(themeXml().replace(customDash, '<d:custDash><d:ds d="800000" sp="300000"/></d:custDash>'))
  })

  it.each(['omitted', 'solid', 'empty-custom'] as const)('clears a custom dash using $0', async (reset) => {
    const { source, document, lines } = await fixture()
    if (reset === 'omitted') delete lineAt(lines, 1).style
    else lineAt(lines, 1).style = reset === 'solid' ? 'solid' : { custom: [] }
    expect(await themeOf(await exportPptx(document, source))).toBe(themeXml().replace(customDash, ''))
  })

  it('preserves padded and skipped custom segments when only the width changes', async () => {
    const { source, document, lines } = await fixture()
    expect(lineAt(lines, 1).style).toEqual({ custom: [{ dash: 400000, space: 200000 }] })
    lineAt(lines, 1).width = 38100
    expect(await themeOf(await exportPptx(document, source))).toBe(themeXml().replace("w='19050'", "w='38100'"))
  })

  it('replaces a miter with a round join without retaining a second join', async () => {
    const { source, document, lines } = await fixture()
    lineAt(lines).join = 'round'
    expect(await themeOf(await exportPptx(document, source))).toBe(themeXml().replace(miter, '<d:round/>'))
  })

  it('removes a cleared join while retaining arrows and explicit solid dash', async () => {
    const { source, document, lines } = await fixture()
    delete lineAt(lines).join
    delete lineAt(lines).miterLimit
    expect(await themeOf(await exportPptx(document, source))).toBe(themeXml().replace(miter, ''))
  })

  it('inserts a join after a custom dash and before the arrowheads', async () => {
    const original = themeXml(secondLine.replace('<d:round/>', ''))
    const { source, document, lines } = await fixture(original)
    lineAt(lines).join = 'bevel'
    expect(await themeOf(await exportPptx(document, source))).toBe(original.replace(customDash, customDash + '<d:bevel/>'))
  })
})

describe('theme line fill changes and slot boundaries', () => {
  it('changes the solid color without disturbing the line attributes or default dash', async () => {
    const { source, document, lines } = await fixture()
    lineAt(lines).color = { type: 'srgb', v: 'FF0000' }
    const output = await exportPptx(document, source)
    expect(await themeOf(output)).toBe(themeXml().replace("<d:schemeClr val='phClr'/>", '<d:srgbClr val="FF0000"/>'))
    const imported = await importPptx(output)
    const theme = Object.values(imported.themes ?? {})[0]
    const slide = imported.slides[imported.slideOrder[0]!]!
    const shape = imported.elements[slide.elementIds[0]!]
    if (shape?.kind !== 'shape') throw new Error('styled shape missing')
    expect(resolveStyleLine(shape.styleRef?.line, theme)).toEqual({ rgb: 'FF0000', alpha: 100000 })
    expect(resolveStyleLineStroke(shape.styleRef?.line, theme)?.width).toBe(12700)
  })

  it('changes gradient stop colors but preserves the axis, custom dash and line metadata', async () => {
    const { source, document, lines } = await fixture()
    lineAt(lines, 1).gradient!.stops[1]!.color = { type: 'system', v: 'FFFFFF', systemName: 'window' }
    const newStops = '<d:gsLst><d:gs pos="0"><d:schemeClr val="phClr"/></d:gs><d:gs pos="100000"><d:sysClr val="window" lastClr="FFFFFF"/></d:gs></d:gsLst>'
    const output = await exportPptx(document, source)
    expect(await themeOf(output)).toBe(themeXml().replace(stops, newStops))
    expect(lineAt(await linesOf(output), 1).gradient!.stops[1]!.color).toEqual({ type: 'system', v: 'FFFFFF', systemName: 'window' })
  })

  it('changes a pattern preset without altering its colors or line slot', async () => {
    const { source, document, lines } = await fixture()
    lineAt(lines, 2).pattern!.preset = 'ltHorz'
    expect(await themeOf(await exportPptx(document, source))).toBe(themeXml().replace("prst='pct10'", "prst='ltHorz'"))
  })

  it('changes the fill kind while retaining all line properties', async () => {
    const { source, document, lines } = await fixture()
    const line = lineAt(lines)
    line.color = { type: 'srgb', v: '112233' }
    line.pattern = { preset: 'pct10', foreground: line.color, background: { type: 'srgb', v: 'FFFFFF' } }
    const replacement = '<d:pattFill prst="pct10"><d:fgClr><d:srgbClr val="112233"/></d:fgClr><d:bgClr><d:srgbClr val="FFFFFF"/></d:bgClr></d:pattFill>'
    expect(await themeOf(await exportPptx(document, source))).toBe(themeXml().replace(solid, replacement))
  })

  it('clears a readable line to noFill without deleting its slot or unknown content', async () => {
    const { source, document, lines } = await fixture()
    lines[0] = null
    const output = await exportPptx(document, source)
    expect(await themeOf(output)).toBe(themeXml().replace(firstLine, "<d:ln data-line='keep'><d:noFill/>" + arrows + extension + '</d:ln>'))
    expect(await linesOf(output)).toHaveLength(7)
    expect((await linesOf(output))[0]).toBeNull()
  })

  it('restores a noFill slot from its explicit model while keeping the line wrapper', async () => {
    const { source, document, lines } = await fixture()
    lines[5] = { color: { type: 'srgb', v: 'FF0000' }, width: 25400, cap: 'rnd' }
    const replacement = "<d:ln w='25400' cap='rnd' data-empty='keep'><d:solidFill><d:srgbClr val=\"FF0000\"/></d:solidFill>" + arrows + extension + '</d:ln>'
    const output = await exportPptx(document, source)
    expect(await themeOf(output)).toBe(themeXml().replace(noFill, replacement))
    expect(lineAt(await linesOf(output), 5)).toEqual(lines[5])
  })

  it('keeps imported null slots and explicit defaults byte-identical during an unrelated edit', async () => {
    const { source, document, theme } = await fixture()
    theme.colors.accent1 = { type: 'srgb', v: 'FF0000' }
    expect(await themeOf(await exportPptx(document, source))).toBe(themeXml().replace('val="4472C4"', 'val="FF0000"'))
  })

  it('does not shift indexes by filtering picture or unknown entries', async () => {
    const { source, document, lines } = await fixture()
    expect(lines.slice(3, 6)).toEqual([null, null, null])
    lineAt(lines, 6).width = 25400
    expect(await themeOf(await exportPptx(document, source))).toBe(themeXml().replace('<d:ln data-last="keep">', '<d:ln w="25400" data-last="keep">'))
  })

  it('does not create, remove or append line slots for a shorter or longer model list', async () => {
    const { theme, lines } = await fixture()
    const short = [structuredClone(lineAt(lines))]
    short[0]!.width = 25400
    const source = themeXml()
    expect(rewriteThemeXml(source, { ...theme, formatScheme: { lineStyles: short } })).toBe(source.replace("w='012700'", "w='25400'"))
    expect(rewriteThemeXml(source, { ...theme, formatScheme: { lineStyles: [...lines, short[0]!] } })).toBe(source)
    const noList = source.replace('<d:lnStyleLst data-list="keep">' + linesXml + '</d:lnStyleLst>', '')
    expect(rewriteThemeXml(noList, { ...theme, formatScheme: { lineStyles: short } })).toBe(noList)
  })

  it('leaves invalid source attributes alone when they are absent from the model', async () => {
    const line = "<d:ln w='bad' cap='future' cmpd='future' algn='outside'>" + solid + "<d:prstDash val='future'/><d:miter lim='-1'/>" + arrows + '</d:ln>'
    const original = themeXml(line)
    const { source, document, lines } = await fixture(original)
    lineAt(lines).color = { type: 'srgb', v: 'FF0000' }
    expect(await themeOf(await exportPptx(document, source))).toBe(original.replace("<d:schemeClr val='phClr'/>", '<d:srgbClr val="FF0000"/>'))
  })

  it('expands a bare line with fill, dash, join and attributes in schema order', async () => {
    const original = themeXml('<d:ln/>')
    const { source, document, lines } = await fixture(original)
    lines[0] = { color: { type: 'srgb', v: 'FF0000' }, width: 25400, cap: 'sq', style: 'dash', join: 'bevel' }
    const output = await exportPptx(document, source)
    expect(await themeOf(output)).toBe(original.replace('<d:ln/>', '<d:ln w="25400" cap="sq"><d:solidFill><d:srgbClr val="FF0000"/></d:solidFill><d:prstDash val="dash"/><d:bevel/></d:ln>'))
    expect(await linesOf(output)).toEqual(lines)
  })

  it('inserts fill, dash and join before existing arrowheads when the source has no fill', async () => {
    const original = themeXml('<d:ln>' + arrows + extension + '</d:ln>')
    const { source, document, lines } = await fixture(original)
    lines[0] = { color: { type: 'srgb', v: 'FF0000' }, style: { custom: [{ dash: 400000, space: 200000 }] }, join: 'miter', miterLimit: 800000 }
    const content = '<d:solidFill><d:srgbClr val="FF0000"/></d:solidFill><d:custDash><d:ds d="400000" sp="200000"/></d:custDash><d:miter lim="800000"/>'
    expect(await themeOf(await exportPptx(document, source))).toBe(original.replace('<d:ln>', '<d:ln>' + content))
  })

  it('preserves a local namespace binding when a dash choice changes kind', async () => {
    const local = '<s:prstDash xmlns:s="' + drawingNamespace + '" val="solid"/>'
    const original = themeXml(firstLine.replace(explicitSolid, local))
    const { source, document, lines } = await fixture(original)
    lineAt(lines).style = { custom: [{ dash: 400000, space: 200000 }] }
    expect(await themeOf(await exportPptx(document, source))).toBe(original.replace(local, '<s:custDash xmlns:s="' + drawingNamespace + '"><s:ds d="400000" sp="200000"/></s:custDash>'))
  })

  it('uses the default namespace for new line children instead of introducing a:', async () => {
    const original = themeXml(firstLine).replaceAll('<d:', '<').replaceAll('</d:', '</').replace('xmlns:d=', 'xmlns=')
    const { source, document, lines } = await fixture(original)
    lineAt(lines).style = { custom: [{ dash: 400000, space: 200000 }] }
    expect(await themeOf(await exportPptx(document, source))).toBe(original.replace(explicitSolid.replace('<d:', '<'), '<custDash><ds d="400000" sp="200000"/></custDash>'))
  })
})

describe('invalid theme line edits fail with their field path', () => {
  it.each([
    { key: 'width', value: -1 }, { key: 'width', value: 1.5 }, { key: 'cap', value: 'future' },
    { key: 'join', value: 'future' }, { key: 'compound', value: 'future' }, { key: 'align', value: 'outside' },
    { key: 'miterLimit', value: 0 }, { key: 'style', value: null }, { key: 'style', value: 'future' },
    { key: 'style', value: { custom: [{ dash: 0, space: 100000 }] } },
  ])('rejects $key=$value rather than ignoring or emitting it', ({ key, value }) => {
    expect(() => rewriteThemeXml(themeXml(), {
      id: 'theme_1', colors: {}, formatScheme: { lineStyles: [{ color: { type: 'srgb', v: 'FF0000' }, [key]: value } as ThemeLineStyle] },
    })).toThrow(/PPTX export theme.*theme_1\.formatScheme\.lineStyles\[0\]/u)
  })
})

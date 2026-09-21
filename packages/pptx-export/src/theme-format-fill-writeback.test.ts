import type { Fill, Theme, ThemeFormatScheme } from '@ppt4ai/model'
import { resolveSlideBackground, resolveStyleFill } from '@ppt4ai/model'
import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx, rewriteThemeXml } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const drawingNamespace = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const presentationNamespace = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const relationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const themePath = 'ppt/theme/theme1.xml'
const lists = [
  { key: 'fillStyles', tag: 'fillStyleLst' },
  { key: 'backgroundStyles', tag: 'bgFillStyleLst' },
] as const
type ListKey = typeof lists[number]['key']
const solid = "<d:solidFill data-fill='keep'><d:srgbClr val='112233'/><d:extLst data-solid='keep'/></d:solidFill>"
const stopList = "<d:gsLst><d:gs pos='00000'><d:schemeClr val='phClr'><d:satMod val='105000'/><d:tint val='067000'/></d:schemeClr></d:gs>"
  + "<d:gs pos='100000'><d:srgbClr val='445566'/></d:gs></d:gsLst>"
const axis = "<d:lin ang='05400000' scaled='false'/>"
const gradient = "<d:gradFill rotWithShape='1' flip='xy'>" + stopList + axis
  + "<d:tileRect l='10000'/><d:extLst data-gradient='keep'/></d:gradFill>"
const foreground = "<d:fgClr><d:srgbClr val='334455'/></d:fgClr>"
const background = "<d:bgClr><d:srgbClr val='EFEFEF'/></d:bgClr>"
const pattern = "<d:pattFill prst='pct10' data-pattern='keep'>" + foreground + background + "<d:extLst data-pattern-ext='keep'/></d:pattFill>"
const picture = '<d:blipFill><d:blip r:embed="rIdImage"/><d:srcRect l="1000"/><d:stretch><d:fillRect/></d:stretch></d:blipFill>'
const unknown = '<x:unknownFill data-unknown="keep"/>'
const noFill = "<d:noFill data-empty='keep'/>"
const laterSolid = '<d:solidFill><d:srgbClr val="778899"/></d:solidFill>'
const entries = [solid, gradient, pattern, picture, unknown, noFill, laterSolid].join('<!--between entries-->')
const lineList = '<d:lnStyleLst><d:ln w="6350" cap="flat" cmpd="sng" algn="ctr">'
  + '<d:solidFill><d:schemeClr val="phClr"/></d:solidFill><d:prstDash val="lgDashDot"/></d:ln></d:lnStyleLst>'
const effectList = '<d:effectStyleLst><d:effectStyle><d:effectLst><d:glow rad="63500">'
  + '<d:srgbClr val="FF0000"/></d:glow></d:effectLst></d:effectStyle></d:effectStyleLst>'

function themeXml(fills = entries, backgrounds = entries): string {
  return '<d:theme xmlns:d="' + drawingNamespace + '" xmlns:r="' + relationshipNamespace + '" xmlns:x="urn:unknown" data-theme="keep">'
    + '<d:themeElements><d:clrScheme name="Custom"><d:accent1><d:srgbClr val="4472C4"/></d:accent1>'
    + '<d:lt1><d:srgbClr val="FFFFFF"/></d:lt1></d:clrScheme><d:fontScheme name="Custom"/>'
    + '<d:fmtScheme name="Custom" data-matrix="keep"><d:fillStyleLst data-list="fills">' + fills + '</d:fillStyleLst>'
    + lineList + effectList + '<d:bgFillStyleLst data-list="backgrounds">' + backgrounds + '</d:bgFillStyleLst>'
    + '<x:matrixExtension/></d:fmtScheme></d:themeElements></d:theme>'
}

function changedList(key: ListKey, before: string, after: string): string {
  return key === 'fillStyles' ? themeXml(entries.replace(before, after), entries) : themeXml(entries, entries.replace(before, after))
}

function sourcePackage(theme = themeXml()): Uint8Array {
  const relationship = (type: string, target: string) => '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="' + relationshipNamespace + '/' + type + '" Target="' + target + '"/></Relationships>'
  const namespaces = 'xmlns:p="' + presentationNamespace + '" xmlns:a="' + drawingNamespace + '"'
  const slide = '<p:sld ' + namespaces + '><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="lt1"/></p:bgRef></p:bg><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Styled"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>'
    + '<p:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef>'
    + '<a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>'
    + '</p:sp></p:spTree></p:cSld></p:sld>'
  const parts: Array<[string, string]> = [
    ['ppt/presentation.xml', '<p:presentation xmlns:p="' + presentationNamespace + '" xmlns:r="' + relationshipNamespace + '">'
      + '<p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'],
    ['ppt/_rels/presentation.xml.rels', relationship('slide', 'slides/slide1.xml')],
    ['ppt/slides/slide1.xml', slide],
    ['ppt/slides/_rels/slide1.xml.rels', relationship('slideLayout', '../slideLayouts/slideLayout1.xml')],
    ['ppt/slideLayouts/slideLayout1.xml', '<p:sldLayout ' + namespaces + '><p:cSld><p:spTree/></p:cSld></p:sldLayout>'],
    ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', relationship('slideMaster', '../slideMasters/slideMaster1.xml')],
    ['ppt/slideMasters/slideMaster1.xml', '<p:sldMaster ' + namespaces + '><p:cSld><p:spTree/></p:cSld></p:sldMaster>'],
    ['ppt/slideMasters/_rels/slideMaster1.xml.rels', relationship('theme', '../theme/theme1.xml')],
    [themePath, theme],
    ['ppt/theme/_rels/theme1.xml.rels', relationship('image', '../media/image1.png')],
  ]
  return writeStoredZip([
    ...parts.map(([name, xml]) => ({ name, data: new TextEncoder().encode(xml) })),
    { name: 'ppt/media/image1.png', data: new Uint8Array([137, 80, 78, 71]) },
  ])
}

async function fixture(xml = themeXml()) {
  const source = sourcePackage(xml)
  const document = await importPptx(source)
  const theme = Object.values(document.themes ?? {})[0]
  if (!theme?.formatScheme) throw new Error('fixture theme format scheme is missing')
  return { source, document, theme, scheme: theme.formatScheme }
}

function fillAt(scheme: ThemeFormatScheme, key: ListKey, index: number): Fill {
  const fill = scheme[key]?.[index]
  if (!fill) throw new Error('fixture fill is missing: ' + key + '[' + index + ']')
  return fill
}

async function themeOf(bytes: Uint8Array): Promise<string> {
  const data = (await readZipEntries(bytes)).find((entry) => entry.name === themePath)?.data
  if (!data) throw new Error('theme part missing')
  return new TextDecoder().decode(data)
}

async function schemeOf(bytes: Uint8Array): Promise<ThemeFormatScheme> {
  const scheme = Object.values((await importPptx(bytes)).themes ?? {})[0]?.formatScheme
  if (!scheme) throw new Error('reimported format scheme missing')
  return scheme
}

describe.each(lists)('source-backed theme $key slots', ({ key }) => {
  // Leaving fmtScheme unvisited fails the changed color; replacing its whole list loses sibling bytes.
  it('writes a solid color edit in its existing slot, preserving everything outside the color node', async () => {
    const { source, document, scheme } = await fixture()
    fillAt(scheme, key, 0).color = { type: 'srgb', v: 'FF0000' }

    const output = await exportPptx(document, source)

    expect(await themeOf(output)).toBe(changedList(key, "<d:srgbClr val='112233'/>", '<d:srgbClr val="FF0000"/>'))
    expect(fillAt(await schemeOf(output), key, 0).color).toEqual({ type: 'srgb', v: 'FF0000' })
  })

  it('writes gradient stop changes without rewriting the axis, tile rectangle or extensions', async () => {
    const { source, document, scheme } = await fixture()
    fillAt(scheme, key, 1).gradient!.stops[1]!.color = { type: 'system', v: 'FFFFFF', systemName: 'window' }
    const changedStops = '<d:gsLst><d:gs pos="0"><d:schemeClr val="phClr"><d:satMod val="105000"/><d:tint val="67000"/></d:schemeClr></d:gs>'
      + '<d:gs pos="100000"><d:sysClr val="window" lastClr="FFFFFF"/></d:gs></d:gsLst>'

    const output = await exportPptx(document, source)

    expect(await themeOf(output)).toBe(changedList(key, stopList, changedStops))
    expect(fillAt(await schemeOf(output), key, 1).gradient!.stops[1]!.color).toEqual({ type: 'system', v: 'FFFFFF', systemName: 'window' })
  })

  // A broken mirror (dropping satMod, for example) rewrites the single-quoted stop list and fails this.
  it('writes an angle-only change without rebuilding the stop list', async () => {
    const { source, document, scheme } = await fixture()
    fillAt(scheme, key, 1).gradient!.angle = 0

    const output = await exportPptx(document, source)

    expect(await themeOf(output)).toBe(changedList(key, axis, '<d:lin ang="0" scaled="0"/>'))
    expect(fillAt(await schemeOf(output), key, 1).gradient!.angle).toBe(0)
  })

  it('writes a pattern background edit without rebuilding its foreground or attributes', async () => {
    const { source, document, scheme } = await fixture()
    fillAt(scheme, key, 2).pattern!.background = { type: 'srgb', v: '000000' }

    const output = await exportPptx(document, source)

    expect(await themeOf(output)).toBe(changedList(key, background, '<d:bgClr><d:srgbClr val="000000"/></d:bgClr>'))
    expect(fillAt(await schemeOf(output), key, 2).pattern!.background.v).toBe('000000')
  })

  it('writes a preset-only change while preserving the source colors and quote style', async () => {
    const { source, document, scheme } = await fixture()
    fillAt(scheme, key, 2).pattern!.preset = 'ltHorz'

    expect(await themeOf(await exportPptx(document, source))).toBe(changedList(key, "prst='pct10'", "prst='ltHorz'"))
  })

  it('clears a previously modeled fill to noFill without removing its slot', async () => {
    const { source, document, scheme } = await fixture()
    scheme[key]![0] = null

    const output = await exportPptx(document, source)

    expect(await themeOf(output)).toBe(changedList(key, solid, '<d:noFill/>'))
    const reimported = await schemeOf(output)
    expect(reimported[key]).toHaveLength(7)
    expect(reimported[key]![0]).toBeNull()
    expect(fillAt(reimported, key, 1).gradient).toBeDefined()
  })

  it('can replace an existing noFill slot with an explicit fill', async () => {
    const { source, document, scheme } = await fixture()
    scheme[key]![5] = { color: { type: 'srgb', v: 'FF0000' } }

    const output = await exportPptx(document, source)

    expect(await themeOf(output)).toBe(changedList(key, noFill, '<d:solidFill><d:srgbClr val="FF0000"/></d:solidFill>'))
    expect(fillAt(await schemeOf(output), key, 5).color.v).toBe('FF0000')
  })

  it('keeps picture and unknown slots in the positional map when editing a later slot', async () => {
    const { source, document, scheme } = await fixture()
    expect(scheme[key]!.slice(3, 6)).toEqual([null, null, null])
    fillAt(scheme, key, 6).color.v = 'FF0000'

    expect(await themeOf(await exportPptx(document, source))).toBe(changedList(key, laterSolid,
      '<d:solidFill><d:srgbClr val="FF0000"/></d:solidFill>',
    ))
  })
})

describe('format scheme writeback boundaries and source preservation', () => {
  it('reimports the edited fill and background references without modifying the slide or package dependencies', async () => {
    const { source, document, scheme } = await fixture()
    fillAt(scheme, 'fillStyles', 0).color.v = 'FF0000'
    fillAt(scheme, 'backgroundStyles', 0).color.v = '00FF00'

    const output = await exportPptx(document, source)
    const reimported = await importPptx(output)
    const theme = Object.values(reimported.themes ?? {})[0]
    const slide = reimported.slides[reimported.slideOrder[0]!]!
    const shape = reimported.elements[slide.elementIds[0]!]
    if (shape?.kind !== 'shape') throw new Error('fixture shape is missing')
    expect(resolveStyleFill(shape.styleRef?.fill, theme)).toEqual({ rgb: 'FF0000', alpha: 100000 })
    expect(resolveSlideBackground(slide, undefined, undefined, theme)).toEqual({ rgb: '00FF00', alpha: 100000 })
    const outputParts = new Map((await readZipEntries(output)).map((entry) => [entry.name, entry.data]))
    for (const entry of await readZipEntries(source)) {
      if (entry.name !== themePath) expect(outputParts.get(entry.name), entry.name).toEqual(entry.data)
    }
  })

  it('leaves imported null entries, normalized values and unedited lists byte-identical during a color-scheme edit', async () => {
    const { source, document, theme } = await fixture()
    theme.colors.accent1 = { type: 'srgb', v: '123456' }

    expect(await themeOf(await exportPptx(document, source))).toBe(themeXml().replace('val="4472C4"', 'val="123456"'))
  })

  it('changes fill kind in place without appending or shifting any other slot', async () => {
    const { source, document, scheme } = await fixture()
    scheme.fillStyles![0] = structuredClone(fillAt(scheme, 'fillStyles', 2))
    const newPattern = '<d:pattFill prst="pct10"><d:fgClr><d:srgbClr val="334455"/></d:fgClr>'
      + '<d:bgClr><d:srgbClr val="EFEFEF"/></d:bgClr></d:pattFill>'

    const output = await exportPptx(document, source)

    expect(await themeOf(output)).toBe(changedList('fillStyles', solid, newPattern))
    expect((await schemeOf(output)).fillStyles).toHaveLength(7)
  })

  it('changes a linear gradient to radial without losing the tile rectangle or stop list', async () => {
    const { source, document, scheme } = await fixture()
    const fill = fillAt(scheme, 'backgroundStyles', 1)
    fill.gradient = { stops: fill.gradient!.stops, path: 'circle', fillToRect: { left: 25000, right: 25000 } }
    const radial = '<d:path path="circle"><d:fillToRect l="25000" r="25000"/></d:path>'

    const output = await exportPptx(document, source)

    expect(await themeOf(output)).toBe(changedList('backgroundStyles', axis, radial))
    expect(fillAt(await schemeOf(output), 'backgroundStyles', 1).gradient).toEqual(fill.gradient)
  })

  it('writes a system color name-only edit rather than dropping the name in validation', async () => {
    const systemFill = "<d:solidFill><d:sysClr val='window' lastClr='FFFFFF'/></d:solidFill>"
    const original = themeXml(systemFill)
    const { source, document, scheme } = await fixture(original)
    fillAt(scheme, 'fillStyles', 0).color.systemName = 'menu'

    expect(await themeOf(await exportPptx(document, source))).toBe(original.replace(
      "<d:sysClr val='window' lastClr='FFFFFF'/>", '<d:sysClr val="menu" lastClr="FFFFFF"/>',
    ))
  })

  it('keeps an explicit picture replacement in the same slot while preserving the other picture list', async () => {
    const { source, document, scheme } = await fixture()
    scheme.fillStyles![3] = { color: { type: 'srgb', v: 'FF0000' } }

    expect(await themeOf(await exportPptx(document, source))).toBe(changedList('fillStyles', picture,
      '<d:solidFill><d:srgbClr val="FF0000"/></d:solidFill>',
    ))
  })

  it('does not delete omitted entries or synthesize appended entries', async () => {
    const { source, document, scheme } = await fixture()
    scheme.fillStyles = [{ color: { type: 'srgb', v: 'FF0000' } }]
    scheme.backgroundStyles!.push({ color: { type: 'srgb', v: '00FF00' } })

    expect(await themeOf(await exportPptx(document, source))).toBe(changedList('fillStyles', "<d:srgbClr val='112233'/>", '<d:srgbClr val="FF0000"/>'))
  })

  it('does not create a missing format scheme or fill list', () => {
    const source = '<d:theme xmlns:d="' + drawingNamespace + '"><d:themeElements><d:clrScheme/></d:themeElements></d:theme>'
    const model: Theme = { id: 'theme_1', colors: {}, formatScheme: { fillStyles: [{ color: { type: 'srgb', v: 'FF0000' } }] } }
    expect(rewriteThemeXml(source, model)).toBe(source)
    const withEmpty = source.replace('</d:themeElements>', '<d:fmtScheme><d:bgFillStyleLst/></d:fmtScheme></d:themeElements>')
    expect(rewriteThemeXml(withEmpty, model)).toBe(withEmpty)
  })

  it('preserves unknown fill and glow content while writing line and shadow edits', async () => {
    const { source, document, scheme } = await fixture()
    scheme.fillStyles![4] = { color: { type: 'srgb', v: 'FF0000' } }
    scheme.lineStyles![0]!.width = 25400
    scheme.effectStyles![0] = { color: { type: 'srgb', v: '000000' }, distance: 20000 }

    expect(await themeOf(await exportPptx(document, source))).toBe(themeXml()
      .replace('w="6350"', 'w="25400"')
      .replace('</d:glow>', '</d:glow><d:outerShdw dist="20000"><d:srgbClr val="000000"/></d:outerShdw>'))
  })

  it('uses an existing default namespace rather than inventing an unbound a prefix', async () => {
    const original = themeXml().replaceAll('<d:', '<').replaceAll('</d:', '</').replace('xmlns:d=', 'xmlns=')
    const { source, document, scheme } = await fixture(original)
    fillAt(scheme, 'fillStyles', 0).color.v = 'FF0000'

    expect(await themeOf(await exportPptx(document, source))).toBe(original.replace("<srgbClr val='112233'/>", '<srgbClr val="FF0000"/>'))
  })

  it.each([
    {
      tag: 'solidFill', fill: { color: { type: 'srgb', v: 'FF0000' } } as Fill,
      content: '<s:srgbClr val="FF0000"/>',
    },
    {
      tag: 'gradFill', fill: {
        color: { type: 'srgb', v: '112233' },
        gradient: { stops: [{ pos: 0, color: { type: 'srgb', v: '112233' } }, { pos: 100000, color: { type: 'srgb', v: '445566' } }], angle: 0 },
      } as Fill,
      content: '<s:gsLst><s:gs pos="0"><s:srgbClr val="112233"/></s:gs><s:gs pos="100000"><s:srgbClr val="445566"/></s:gs></s:gsLst><s:lin ang="0"/>',
    },
    {
      tag: 'pattFill', fill: {
        color: { type: 'srgb', v: '112233' },
        pattern: { preset: 'pct10', foreground: { type: 'srgb', v: '112233' }, background: { type: 'srgb', v: '445566' } },
      } as Fill,
      content: '<s:fgClr><s:srgbClr val="112233"/></s:fgClr><s:bgClr><s:srgbClr val="445566"/></s:bgClr>',
    },
  ])('replaces an unreadable empty $tag slot safely when an explicit fill is supplied', async ({ tag, fill, content }) => {
    const local = '<s:' + tag + ' xmlns:s="' + drawingNamespace + '"/>'
    const original = themeXml(local)
    const { source, document, scheme } = await fixture(original)
    expect(scheme.fillStyles![0]).toBeNull()
    scheme.fillStyles![0] = fill
    const expected = '<s:' + tag + ' xmlns:s="' + drawingNamespace + '"' + (tag === 'pattFill' ? ' prst="pct10"' : '') + '>' + content + '</s:' + tag + '>'

    const output = await exportPptx(document, source)

    expect(await themeOf(output)).toBe(original.replace(local, expected))
    expect(fillAt(await schemeOf(output), 'fillStyles', 0)).toEqual(fill)
  })

  it('replaces the axis when a one-stop source becomes a modeled gradient with default geometry', async () => {
    const oldStops = '<d:gsLst><d:gs pos="0"><d:srgbClr val="112233"/></d:gs></d:gsLst>'
    const oldAxis = "<d:lin ang='5400000' scaled='1'/>"
    const entry = '<d:gradFill rotWithShape="1">' + oldStops + oldAxis + '<d:tileRect l="10000"/></d:gradFill>'
    const original = themeXml(entry)
    const { source, document, scheme } = await fixture(original)
    expect(fillAt(scheme, 'fillStyles', 0).gradient).toBeUndefined()
    const fill: Fill = {
      color: { type: 'srgb', v: '112233' },
      gradient: { stops: [{ pos: 0, color: { type: 'srgb', v: '112233' } }, { pos: 100000, color: { type: 'srgb', v: '445566' } }] },
    }
    scheme.fillStyles![0] = fill
    const newStops = '<d:gsLst><d:gs pos="0"><d:srgbClr val="112233"/></d:gs><d:gs pos="100000"><d:srgbClr val="445566"/></d:gs></d:gsLst>'

    const output = await exportPptx(document, source)

    expect(await themeOf(output)).toBe(original.replace(oldStops, newStops).replace(oldAxis, '<d:lin/>'))
    expect(fillAt(await schemeOf(output), 'fillStyles', 0)).toEqual(fill)
  })

  it('retains a fill-local namespace binding when replacing the fill kind', async () => {
    const local = '<s:solidFill xmlns:s="' + drawingNamespace + '"><s:srgbClr val="112233"/></s:solidFill>'
    const original = themeXml(local)
    const { source, document, scheme } = await fixture(original)
    scheme.fillStyles![0] = null

    expect(await themeOf(await exportPptx(document, source))).toBe(original.replace(local, '<s:noFill xmlns:s="' + drawingNamespace + '"/>'))
  })
})

describe('invalid fill edits fail at the theme boundary', () => {
  it.each([
    { name: 'missing color', fill: {} },
    { name: 'invalid color', fill: { color: { type: 'srgb', v: 'invalid' } } },
    { name: 'invalid transform token', fill: { color: { type: 'srgb', v: '112233', transforms: [{ type: 'x/><bad' }] } } },
    { name: 'too few gradient stops', fill: { color: { type: 'srgb', v: '112233' }, gradient: { stops: [] } } },
    { name: 'out-of-range stop', fill: { color: { type: 'srgb', v: '112233' }, gradient: { stops: [
      { pos: -1, color: { type: 'srgb', v: '112233' } }, { pos: 100000, color: { type: 'srgb', v: '445566' } },
    ] } } },
    { name: 'invalid pattern', fill: { color: { type: 'srgb', v: '112233' }, pattern: { preset: 'pct10', foreground: { type: 'srgb', v: '112233' } } } },
  ])('rejects $name instead of silently ignoring the edit or emitting malformed XML', ({ fill }) => {
    expect(() => rewriteThemeXml(themeXml(), {
      id: 'theme_1', colors: {}, formatScheme: { fillStyles: [fill as Fill] },
    })).toThrow(/PPTX export theme.*theme_1\.formatScheme\.fillStyles\[0\]/u)
  })
})

import { resolveStyleEffect, type OuterShadow, type Ppt4aiDocument, type ThemeEffectStyleEntry } from '@ppt4ai/model'
import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { createPptx, exportPptx, rewriteThemeXml } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const drawingNamespace = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const glow = "<d:glow rad='63500'><d:srgbClr val='FF0000'/></d:glow>"
const inner = "<d:innerShdw blurRad='1000'><d:srgbClr val='000000'/></d:innerShdw>"
const reflection = "<d:reflection blurRad='1000' stA='50000'/>"
const softEdge = "<d:softEdge rad='2000'/>"
const color = "<d:schemeClr val='phClr' data-color='keep'><d:alpha val='063000'/></d:schemeClr>"
const outer = "<d:outerShdw blurRad='057150' dist='019050' dir='05400000' sx='90000' sy='80000' kx='60000' ky='120000' algn='ctr' rotWithShape='0'>"
  + color + '</d:outerShdw>'
const scene = "<d:scene3d data-scene='keep'/>"
const shape3d = "<d:sp3d data-3d='keep'/>"
const slot = "<d:effectStyle data-style='keep'><d:effectLst data-list='keep'>" + glow + inner + outer
  + reflection + softEdge + '<x:extra/></d:effectLst>' + scene + shape3d + '</d:effectStyle>'
const glowSlot = '<d:effectStyle><d:effectLst>' + glow + inner + reflection + softEdge + '</d:effectLst></d:effectStyle>'
const emptySlot = "<d:effectStyle data-empty='keep'><d:effectLst data-empty-list='keep'/></d:effectStyle>"
const dagSlot = '<d:effectStyle><d:effectDag type="tree"><d:cont name="nested">' + outer + '</d:cont></d:effectDag>' + scene + '</d:effectStyle>'
const unknownSlot = '<x:unknownEffectStyle data-unknown="keep"/>'
const unreadableOuter = "<d:outerShdw blurRad='1000' dist='2000' sx='90000'><d:hslClr hue='0' sat='0' lum='0'/></d:outerShdw>"
const unreadableSlot = '<d:effectStyle><d:effectLst>' + unreadableOuter + glow + '</d:effectLst></d:effectStyle>'
const lastOuter = '<d:outerShdw blurRad="12700"><d:srgbClr val="112233"/></d:outerShdw>'
const lastSlot = '<d:effectStyle><d:effectLst>' + lastOuter + '</d:effectLst></d:effectStyle>'
const slots = [slot, glowSlot, emptySlot, dagSlot, unknownSlot, unreadableSlot, lastSlot].join('<!--between slots-->')
const basicShadow: OuterShadow = { color: { type: 'srgb', v: '000000' }, blurRadius: 12700 }
const basicOuter = '<d:outerShdw blurRad="12700"><d:srgbClr val="000000"/></d:outerShdw>'

function themeXml(effects = slots): string {
  return '<d:theme xmlns:d="' + drawingNamespace + '" xmlns:x="urn:unknown"><d:themeElements>'
    + '<d:clrScheme name="Custom"><d:accent1><d:srgbClr val="4472C4"/></d:accent1></d:clrScheme><d:fontScheme name="Custom"/>'
    + '<d:fmtScheme name="Custom"><d:fillStyleLst><d:solidFill><d:schemeClr val="phClr"/></d:solidFill></d:fillStyleLst>'
    + '<d:lnStyleLst><d:ln w="12700"><d:solidFill><d:schemeClr val="phClr"/></d:solidFill></d:ln></d:lnStyleLst>'
    + '<d:effectStyleLst data-effects="keep">' + effects + '</d:effectStyleLst><d:bgFillStyleLst/></d:fmtScheme></d:themeElements></d:theme>'
}

const baseDocument: Ppt4aiDocument = {
  format: 'ppt4ai', version: 1, id: 'effect-writeback', page: { w: 12192000, h: 6858000 },
  slides: { sld_1: { id: 'sld_1', elementIds: ['shape_1'], layoutId: 'lyt_1' } }, slideOrder: ['sld_1'],
  layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } }, masters: { mst_1: { id: 'mst_1', themeId: 'theme_1' } },
  themes: { theme_1: { id: 'theme_1', colors: {} } },
  elements: { shape_1: { id: 'shape_1', kind: 'shape', preset: 'rect', bounds: { x: 1000000, y: 1000000, w: 2000000, h: 1000000 },
    styleRef: { line: { idx: 1 }, fill: { idx: 1 }, effect: { idx: 1, color: { type: 'scheme', v: 'accent1' } }, font: { idx: 'minor' } },
  } },
}

async function fixture(xml = themeXml()) {
  const parts = await readZipEntries(await createPptx(baseDocument))
  const part = parts.find((entry) => entry.name === 'ppt/theme/theme1.xml')!
  part.data = new TextEncoder().encode(xml)
  const source = writeStoredZip(parts)
  const document = await importPptx(source)
  const theme = Object.values(document.themes ?? {})[0]!
  const effects = theme.formatScheme?.effectStyles
  if (!effects) throw new Error('fixture effects are missing')
  return { source, document, theme, effects }
}

function shadowAt(effects: ThemeEffectStyleEntry[], index = 0): OuterShadow {
  const shadow = effects[index]
  if (!shadow) throw new Error('fixture shadow missing: ' + index)
  return shadow
}

async function themeOf(bytes: Uint8Array): Promise<string> {
  const part = (await readZipEntries(bytes)).find((entry) => entry.name === 'ppt/theme/theme1.xml')
  if (!part) throw new Error('theme part missing')
  return new TextDecoder().decode(part.data)
}

async function effectsOf(bytes: Uint8Array): Promise<ThemeEffectStyleEntry[]> {
  const effects = Object.values((await importPptx(bytes)).themes ?? {})[0]?.formatScheme?.effectStyles
  if (!effects) throw new Error('reimported effects missing')
  return effects
}

describe('existing theme outer shadows are patched part by part', () => {
  // Whole-node serialization would discard sx/algn, padded values and the single-quoted color here.
  it.each([
    { key: 'blurRadius', value: 12700, before: "blurRad='057150'", after: "blurRad='12700'" },
    { key: 'blurRadius', value: 0, before: "blurRad='057150'", after: "blurRad='0'" },
    { key: 'distance', value: 38100, before: "dist='019050'", after: "dist='38100'" },
    { key: 'distance', value: 0, before: "dist='019050'", after: "dist='0'" },
    { key: 'direction', value: 2700000, before: "dir='05400000'", after: "dir='2700000'" },
    { key: 'direction', value: -5400000, before: "dir='05400000'", after: "dir='-5400000'" },
  ] as const)('patches only $key=$value, preserving every other source byte', async ({ key, value, before, after }) => {
    const { source, document, effects } = await fixture()
    Object.assign(shadowAt(effects), { [key]: value })
    const output = await exportPptx(document, source)
    expect(await themeOf(output)).toBe(themeXml().replace(before, after))
    expect(shadowAt(await effectsOf(output))[key]).toBe(value)
  })

  it.each([
    { key: 'blurRadius', attribute: " blurRad='057150'" },
    { key: 'distance', attribute: " dist='019050'" },
    { key: 'direction', attribute: " dir='05400000'" },
  ] as const)('removes a cleared $key without rebuilding the shadow', async ({ key, attribute }) => {
    const { source, document, effects } = await fixture()
    delete shadowAt(effects)[key]
    const output = await exportPptx(document, source)
    expect(await themeOf(output)).toBe(themeXml().replace(attribute, ''))
    expect(shadowAt(await effectsOf(output))[key]).toBeUndefined()
  })

  it('changes the color without normalizing any geometry or dropping sibling effects', async () => {
    const { source, document, effects } = await fixture()
    shadowAt(effects).color = { type: 'srgb', v: 'FF0000' }
    expect(await themeOf(await exportPptx(document, source))).toBe(themeXml().replace(color, '<d:srgbClr val="FF0000"/>'))
  })

  it('writes a transform-only alpha edit, including the placeholder effectRef resolution', async () => {
    const { source, document, effects } = await fixture()
    shadowAt(effects).color.transforms = [{ type: 'alpha', value: 40000 }]
    const output = await exportPptx(document, source)
    expect(await themeOf(output)).toBe(themeXml().replace(color, '<d:schemeClr val="phClr"><d:alpha val="40000"/></d:schemeClr>'))
    const imported = await importPptx(output)
    const theme = Object.values(imported.themes ?? {})[0]
    const slide = imported.slides[imported.slideOrder[0]!]!
    const shape = imported.elements[slide.elementIds[0]!]
    if (shape?.kind !== 'shape') throw new Error('effect-ref shape missing')
    expect(resolveStyleEffect(shape.styleRef?.effect, theme)).toEqual({
      color: { rgb: '4472C4', alpha: 40000 }, blurRadius: 57150, distance: 19050, direction: 5400000,
    })
    const after = new Map((await readZipEntries(output)).map((entry) => [entry.name, entry.data]))
    for (const part of await readZipEntries(source)) {
      if (part.name !== 'ppt/theme/theme1.xml') expect(after.get(part.name), part.name).toEqual(part.data)
    }
  })

  it('keeps the system color name when only that name changes', async () => {
    const system = "<d:sysClr val='window' lastClr='FFFFFF'/>"
    const original = themeXml(slot.replace(color, system))
    const { source, document, effects } = await fixture(original)
    shadowAt(effects).color.systemName = 'menu'
    expect(await themeOf(await exportPptx(document, source))).toBe(original.replace(system, '<d:sysClr val="menu" lastClr="FFFFFF"/>'))
  })

  it('leaves unmodeled invalid geometry untouched when only the color is edited', async () => {
    const original = themeXml(slot.replace("blurRad='057150'", "blurRad='bad'").replace("dir='05400000'", "dir='1.5'"))
    const { source, document, effects } = await fixture(original)
    shadowAt(effects).color = { type: 'srgb', v: 'FF0000' }
    expect(await themeOf(await exportPptx(document, source))).toBe(original.replace(color, '<d:srgbClr val="FF0000"/>'))
  })

  it('removes only a readable outerShdw when its slot becomes null', async () => {
    const { source, document, effects } = await fixture()
    effects[0] = null
    const output = await exportPptx(document, source)
    expect(await themeOf(output)).toBe(themeXml().replace(outer, ''))
    expect(await effectsOf(output)).toHaveLength(7)
    expect((await effectsOf(output))[0]).toBeNull()
  })

  it('keeps an empty effect list and the existing style slot after removing its last shadow', async () => {
    const original = themeXml(lastSlot)
    const { source, document, effects } = await fixture(original)
    effects[0] = null
    expect(await themeOf(await exportPptx(document, source))).toBe(original.replace(lastOuter, ''))
  })

  it('preserves imported null slots, an unreadable shadow and effectDag during unrelated editing', async () => {
    const { source, document, theme, effects } = await fixture()
    expect(effects.slice(1, 6)).toEqual([null, null, null, null, null])
    theme.colors.accent1 = { type: 'srgb', v: 'FF0000' }
    expect(await themeOf(await exportPptx(document, source))).toBe(themeXml().replace('val="4472C4"', 'val="FF0000"'))
  })
})

describe('adding an outer shadow respects the source effect structure', () => {
  it('expands an empty effect list while retaining list and style attributes', async () => {
    const { source, document, effects } = await fixture()
    effects[2] = structuredClone(basicShadow)
    const output = await exportPptx(document, source)
    expect(await themeOf(output)).toBe(themeXml().replace("<d:effectLst data-empty-list='keep'/>", "<d:effectLst data-empty-list='keep'>" + basicOuter + '</d:effectLst>'))
    expect((await effectsOf(output))[2]).toEqual(basicShadow)
  })

  it('inserts after innerShdw and before reflection, without replacing glow or other effects', async () => {
    const { source, document, effects } = await fixture()
    effects[1] = structuredClone(basicShadow)
    expect(await themeOf(await exportPptx(document, source))).toBe(themeXml(slots.replace(glowSlot, glowSlot.replace(reflection, basicOuter + reflection))))
  })

  it('adds an effect list before 3D settings when an existing style has none', async () => {
    const original = themeXml('<d:effectStyle>' + scene + shape3d + '</d:effectStyle>')
    const { source, document, effects } = await fixture(original)
    effects[0] = structuredClone(basicShadow)
    expect(await themeOf(await exportPptx(document, source))).toBe(original.replace(scene, '<d:effectLst>' + basicOuter + '</d:effectLst>' + scene))
  })

  it('expands an existing bare effect style rather than adding a new slot', async () => {
    const original = themeXml("<d:effectStyle data-style='keep'/>")
    const { source, document, effects } = await fixture(original)
    effects[0] = structuredClone(basicShadow)
    const output = await exportPptx(document, source)
    expect(await themeOf(output)).toBe(original.replace("<d:effectStyle data-style='keep'/>", "<d:effectStyle data-style='keep'><d:effectLst>" + basicOuter + '</d:effectLst></d:effectStyle>'))
    expect(await effectsOf(output)).toEqual([basicShadow])
  })

  it('repairs a colorless self-closing shadow with geometry and color edits together', async () => {
    const before = '<d:outerShdw/>'
    const original = themeXml('<d:effectStyle><d:effectLst>' + before + '</d:effectLst></d:effectStyle>')
    const { source, document, effects } = await fixture(original)
    effects[0] = { color: { type: 'srgb', v: 'FF0000' }, blurRadius: 12700, distance: 0, direction: -2700000 }
    const output = await exportPptx(document, source)
    expect(await themeOf(output)).toBe(original.replace(before, '<d:outerShdw blurRad="12700" dist="0" dir="-2700000"><d:srgbClr val="FF0000"/></d:outerShdw>'))
    expect(await effectsOf(output)).toEqual(effects)
  })

  it('replaces an unreadable color without keeping stale modeled geometry or adding a second color', async () => {
    const { source, document, effects } = await fixture()
    effects[5] = { color: { type: 'srgb', v: 'FF0000' } }
    const output = await exportPptx(document, source)
    expect(await themeOf(output)).toBe(themeXml().replace(unreadableOuter, "<d:outerShdw sx='90000'><d:srgbClr val=\"FF0000\"/></d:outerShdw>"))
    expect((await effectsOf(output))[5]).toEqual(effects[5])
  })

  it('does not convert effectDag even when a replacement shadow is supplied', async () => {
    const { source, document, effects } = await fixture()
    effects[3] = structuredClone(basicShadow)
    expect(await themeOf(await exportPptx(document, source))).toBe(themeXml())
  })

  it('does not edit nested effect lists or shadow nodes inside an effectDag', async () => {
    const dag = '<d:effectStyle><d:effectDag><d:cont><d:effectLst>' + outer + '</d:effectLst></d:cont></d:effectDag></d:effectStyle>'
    const original = themeXml(dag)
    const { source, document, effects } = await fixture(original)
    effects[0] = structuredClone(basicShadow)
    expect(await themeOf(await exportPptx(document, source))).toBe(original)
  })

  it('keeps all original indexes when modifying a shadow after unknown slots', async () => {
    const { source, document, effects } = await fixture()
    shadowAt(effects, 6).blurRadius = 25400
    expect(await themeOf(await exportPptx(document, source))).toBe(themeXml().replace(lastOuter, lastOuter.replace('12700', '25400')))
  })

  it('ignores unknown slot types and never appends or deletes effect slots', async () => {
    const { theme, effects } = await fixture()
    const longer = structuredClone(effects)
    longer[4] = structuredClone(basicShadow)
    longer.push(structuredClone(basicShadow))
    expect(rewriteThemeXml(themeXml(), { ...theme, formatScheme: { effectStyles: longer } })).toBe(themeXml())
    const first = { ...shadowAt(effects), blurRadius: 12700 }
    expect(rewriteThemeXml(themeXml(), { ...theme, formatScheme: { effectStyles: [first] } })).toBe(themeXml().replace("blurRad='057150'", "blurRad='12700'"))
    const without = themeXml().replace('<d:effectStyleLst data-effects="keep">' + slots + '</d:effectStyleLst>', '')
    expect(rewriteThemeXml(without, { ...theme, formatScheme: { effectStyles: [basicShadow] } })).toBe(without)
  })
})

describe('effect writeback namespace and repeated edit boundaries', () => {
  it('keeps a color-local prefix declaration when replacing its color kind', async () => {
    const localColor = '<s:schemeClr xmlns:s="' + drawingNamespace + '" val="phClr"/>'
    const original = themeXml(slot.replace(color, localColor))
    const { source, document, effects } = await fixture(original)
    shadowAt(effects).color = { type: 'srgb', v: 'FF0000' }
    expect(await themeOf(await exportPptx(document, source))).toBe(original.replace(localColor, '<s:srgbClr xmlns:s="' + drawingNamespace + '" val="FF0000"/>'))
  })

  it('uses the default drawing namespace when inserting an outer shadow', async () => {
    const original = themeXml(emptySlot).replaceAll('<d:', '<').replaceAll('</d:', '</').replace('xmlns:d=', 'xmlns=')
    const { source, document, effects } = await fixture(original)
    effects[0] = structuredClone(basicShadow)
    const added = basicOuter.replaceAll('<d:', '<').replaceAll('</d:', '</')
    expect(await themeOf(await exportPptx(document, source))).toBe(original.replace("<effectLst data-empty-list='keep'/>", "<effectLst data-empty-list='keep'>" + added + '</effectLst>'))
  })

  it('inserts a color using the locally declared prefix of an existing shadow', async () => {
    const before = '<s:outerShdw xmlns:s="' + drawingNamespace + '"/>'
    const original = themeXml('<d:effectStyle><d:effectLst>' + before + '</d:effectLst></d:effectStyle>')
    const { source, document, effects } = await fixture(original)
    effects[0] = { color: { type: 'srgb', v: 'FF0000' } }
    expect(await themeOf(await exportPptx(document, source))).toBe(original.replace(before, '<s:outerShdw xmlns:s="' + drawingNamespace + '"><s:srgbClr val="FF0000"/></s:outerShdw>'))
  })

  it('supports another source-backed edit after the first edited package is reimported', async () => {
    const { source, document, effects } = await fixture()
    shadowAt(effects).blurRadius = 12700
    const first = await exportPptx(document, source)
    const imported = await importPptx(first)
    const updated = Object.values(imported.themes ?? {})[0]!.formatScheme!.effectStyles!
    shadowAt(updated).distance = 38100
    expect(await themeOf(await exportPptx(imported, first))).toBe(themeXml().replace("blurRad='057150'", "blurRad='12700'").replace("dist='019050'", "dist='38100'"))
  })
})

describe('invalid theme effect edits fail before writing', () => {
  it.each([
    { name: 'negative blur', value: { color: { type: 'srgb', v: '112233' }, blurRadius: -1 } },
    { name: 'fractional distance', value: { color: { type: 'srgb', v: '112233' }, distance: 1.5 } },
    { name: 'fractional direction', value: { color: { type: 'srgb', v: '112233' }, direction: 1.5 } },
    { name: 'infinite blur', value: { color: { type: 'srgb', v: '112233' }, blurRadius: Infinity } },
    { name: 'missing color', value: {} },
    { name: 'bad system name', value: { color: { type: 'system', v: 'FFFFFF', systemName: 'x/><bad' } } },
    { name: 'bad transform', value: { color: { type: 'srgb', v: '112233', transforms: [{ type: 'x/><bad' }] } } },
  ])('rejects $name with the theme and effect slot path', ({ value }) => {
    expect(() => rewriteThemeXml(themeXml(), {
      id: 'theme_1', colors: {}, formatScheme: { effectStyles: [value as OuterShadow] },
    })).toThrow(/PPTX export theme.*theme_1\.formatScheme\.effectStyles\[0\]/u)
  })
})

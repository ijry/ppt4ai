import { importPptx } from '@ppt4ai/pptx-import'
import { resolveSlideBackground, resolveStyleFill, resolveStyleLine, resolveStyleLineStroke, type Ppt4aiDocument, type Theme, type ThemeLineStyleEntry } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx, exportPptx } from './index.js'
import { serializeThemeXml } from './standalone-xml.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const phClr = { color: { type: 'scheme' as const, v: 'phClr' } }

function themeWith(formatScheme: Theme['formatScheme']): Theme {
  return {
    id: 'theme-1',
    colors: { accent1: { type: 'srgb', v: '4472C4' }, lt1: { type: 'srgb', v: 'FFFFFF' } },
    ...(formatScheme ? { formatScheme } : {}),
  }
}

function formatSchemeXml(theme?: Theme): string {
  const xml = serializeThemeXml(theme)
  return xml.slice(xml.indexOf('<a:fmtScheme'), xml.indexOf('</a:fmtScheme>') + 14)
}

describe('standalone format scheme serialization', () => {
  /** Before this all four lists were written empty while slides kept emitting their indexes. */
  it('writes every modeled entry, with the line width and dash', () => {
    const xml = formatSchemeXml(themeWith({
      fillStyles: [phClr],
      lineStyles: [{ ...phClr, width: 6350 }, { ...phClr, width: 12700, style: 'dash' }],
      backgroundStyles: [phClr],
    }))

    expect(xml).toContain('<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>')
    expect(xml).toContain('<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="dash"/></a:ln>')
    expect(xml).not.toContain('<a:fillStyleLst/>')
    expect(xml).not.toContain('<a:lnStyleLst/>')
  })

  /**
   * References are positional, so a null entry must keep its slot. `a:noFill` is what the renderer
   * already shows for one, so the file and the canvas agree.
   */
  it('writes a null entry as noFill in its own slot', () => {
    const xml = formatSchemeXml(themeWith({ fillStyles: [phClr, null, phClr] }))
    const fills = xml.slice(xml.indexOf('<a:fillStyleLst>'), xml.indexOf('</a:fillStyleLst>'))

    expect(fills).toBe('<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:noFill/><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>')
  })

  /** A modeled entry with no width gets no `w`: omitting it means "inherit", inventing one lies. */
  it('writes no width for a modeled entry that declares none', () => {
    const xml = formatSchemeXml(themeWith({ lineStyles: [phClr] }))

    expect(xml).toContain('<a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>')
  })

  it('pads a short or missing list up to three entries', () => {
    const padded = formatSchemeXml(themeWith({ lineStyles: [{ ...phClr, width: 3175 }] }))
    expect(padded).toContain('<a:ln w="3175">')
    expect(padded).toContain('<a:ln w="12700">')
    expect(padded).toContain('<a:ln w="19050">')

    const bare = formatSchemeXml(themeWith(undefined))
    expect(bare).toContain('<a:ln w="6350">')
    expect(bare.match(/<a:solidFill>/gu)).toHaveLength(9)
  })

  it('never truncates a list longer than three', () => {
    const xml = formatSchemeXml(themeWith({ fillStyles: [phClr, phClr, phClr, null, phClr] }))
    const fills = xml.slice(xml.indexOf('<a:fillStyleLst>'), xml.indexOf('</a:fillStyleLst>'))

    expect(fills.match(/<a:solidFill>/gu)).toHaveLength(4)
    expect(fills).toContain('<a:noFill/>')
  })

  /** `effectRef` still needs an entry to land on even though effects are not modeled. */
  it('writes three empty effect styles', () => {
    expect(formatSchemeXml(themeWith(undefined)))
      .toContain('<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>')
  })

  /** Gradient entries reach the file through the same serializer shape fills use. */
  it('writes a gradient entry as gradFill', () => {
    const xml = formatSchemeXml(themeWith({
      fillStyles: [{
        color: { type: 'scheme', v: 'phClr' },
        gradient: {
          stops: [
            { pos: 0, color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'tint', value: 67000 }] } },
            { pos: 100000, color: { type: 'scheme', v: 'phClr' } },
          ],
          angle: 5400000,
          scaled: false,
        },
      }],
    }))

    expect(xml).toContain('<a:gradFill><a:gsLst>'
      + '<a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="67000"/></a:schemeClr></a:gs>'
      + '<a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs>'
      + '</a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>')
  })

  /**
   * `cap` is an attribute of `a:ln` while the corner is a child element, and `CT_LineProperties` puts
   * the corner after `a:prstDash`. The element-level stroke has written both since `6888114`; a theme
   * entry can now say the same, so a shape taking its outline from `lnRef` inherits them.
   */
  it('writes the cap attribute and the corner element of an entry', () => {
    const xml = formatSchemeXml(themeWith({
      lineStyles: [{ ...phClr, width: 6350, style: 'dash', cap: 'rnd', join: 'bevel' }],
    }))

    expect(xml).toContain('<a:ln w="6350" cap="rnd"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
      + '<a:prstDash val="dash"/><a:bevel/></a:ln>')
  })

  it('writes neither when the entry states neither', () => {
    const xml = formatSchemeXml(themeWith({ lineStyles: [{ ...phClr, width: 6350 }] }))

    expect(xml).toContain('<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>')
    expect(xml).not.toContain('cap=')
  })
})

const document: Ppt4aiDocument = {
  format: 'ppt4ai',
  version: 1,
  id: 'dck_matrix',
  page: { w: 12192000, h: 6858000 },
  slides: {
    sld_1: {
      id: 'sld_1',
      elementIds: ['el_shape'],
      layoutId: 'lyt_1',
      background: { styleRef: { idx: 1001, color: { type: 'scheme', v: 'lt1' } } },
    },
  },
  slideOrder: ['sld_1'],
  elements: {
    el_shape: {
      id: 'el_shape',
      kind: 'shape',
      preset: 'rect',
      bounds: { x: 1000000, y: 1000000, w: 2000000, h: 1000000 },
      styleRef: {
        line: { idx: 2, color: { type: 'scheme', v: 'accent1' } },
        fill: { idx: 1, color: { type: 'scheme', v: 'accent1' } },
        effect: { idx: 0, color: { type: 'scheme', v: 'accent1' } },
        font: { idx: 'minor', color: { type: 'scheme', v: 'lt1' } },
      },
    },
  },
  layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } },
  masters: { mst_1: { id: 'mst_1', themeId: 'theme-1' } },
  themes: {
    'theme-1': themeWith({
      fillStyles: [phClr, null],
      lineStyles: [{ ...phClr, width: 6350 }, { ...phClr, width: 12700, style: 'dash', cap: 'sq', join: 'round' }],
      backgroundStyles: [phClr],
    }),
  },
}

async function reimported(): Promise<Ppt4aiDocument> {
  return importPptx(await createPptx(document))
}

describe('standalone format scheme round trip', () => {
  it('brings the modeled entries back, nulls included', async () => {
    const scheme = Object.values((await reimported()).themes ?? {})[0]?.formatScheme

    expect(scheme?.fillStyles?.slice(0, 2)).toEqual([phClr, null])
    expect(scheme?.lineStyles?.slice(0, 2)).toEqual([
      { ...phClr, width: 6350 },
      { ...phClr, width: 12700, style: 'dash', cap: 'sq', join: 'round' },
    ])
    expect(scheme?.backgroundStyles?.[0]).toEqual(phClr)
  })

  /** The point of the slice: the references the same package emits now land on real entries. */
  it('resolves the shape and background references of the package it just wrote', async () => {
    const document = await reimported()
    const theme = Object.values(document.themes ?? {})[0]
    const slide = Object.values(document.slides)[0]
    const shape = document.elements[slide?.elementIds[0] ?? '']
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')

    expect(resolveStyleFill(shape.styleRef?.fill, theme)).toEqual({ rgb: '4472C4', alpha: 100000 })
    expect(resolveStyleLine(shape.styleRef?.line, theme)).toEqual({ rgb: '4472C4', alpha: 100000 })
    expect(resolveStyleLineStroke(shape.styleRef?.line, theme))
      .toEqual({ width: 12700, style: 'dash', cap: 'sq', join: 'round' })
  })

  /** The 1001 offset lives on the reference side only, so the list itself stays 1-based. */
  it('resolves a background reference at 1001 to the first list entry', async () => {
    const document = await reimported()
    const theme = Object.values(document.themes ?? {})[0]
    const slide = Object.values(document.slides)[0]

    expect(slide?.background?.styleRef?.idx).toBe(1001)
    expect(resolveSlideBackground(slide, undefined, undefined, theme)).toEqual({ rgb: 'FFFFFF', alpha: 100000 })
  })

  it('stays byte-identical across two generations', async () => {
    expect(await createPptx(document)).toEqual(await createPptx(structuredClone(document)))
  })
})

async function themePartOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  const data = entries.get('ppt/theme/theme1.xml')
  if (!data) throw new Error('missing generated theme')
  return new TextDecoder().decode(data)
}

describe('standalone format scheme in the package', () => {
  it('puts the format scheme in the generated theme part', async () => {
    const theme = await themePartOf(await createPptx(document))

    expect(theme).toContain('<a:prstDash val="dash"/>')
    expect(theme).not.toContain('<a:lnStyleLst/>')
  })
})

const supportedLineFills: ThemeLineStyleEntry[] = [
  {
    color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'satMod', value: 150000 }] },
    gradient: {
      stops: [
        { pos: 0, color: { type: 'scheme', v: 'phClr', transforms: [{ type: 'satMod', value: 150000 }] } },
        { pos: 100000, color: { type: 'system', v: 'FFFFFF', systemName: 'window', transforms: [{ type: 'alpha', value: 50000 }] } },
      ],
      angle: 5400000, scaled: false,
    },
    width: 12700, style: 'lgDashDot', cap: 'rnd', join: 'miter', miterLimit: 400000, compound: 'dbl', align: 'in',
  },
  null,
  {
    color: { type: 'scheme', v: 'phClr' },
    pattern: { preset: 'pct10', foreground: { type: 'scheme', v: 'phClr' }, background: { type: 'srgb', v: 'FFFFFF' } },
    width: 25400, style: { custom: [{ dash: 400000, space: 200000 }] }, cap: 'sq', join: 'round', compound: 'thickThin', align: 'ctr',
  },
  {
    color: { type: 'srgb', v: '112233' },
    gradient: {
      stops: [{ pos: 0, color: { type: 'srgb', v: '112233' } }, { pos: 100000, color: { type: 'srgb', v: '445566' } }],
      path: 'circle', fillToRect: { left: 25000, top: 10000, right: 25000, bottom: 10000 },
    },
    width: 19050, cap: 'flat', join: 'bevel',
  },
]

function nonSolidLineDocument(): Ppt4aiDocument {
  const result = structuredClone(document)
  result.themes!['theme-1']!.formatScheme = { lineStyles: structuredClone(supportedLineFills) }
  const shape = result.elements.el_shape
  if (shape?.kind !== 'shape') throw new Error('fixture shape is missing')
  shape.styleRef!.line!.idx = 3
  return result
}

function lineListXml(xml: string): string {
  const start = xml.indexOf('<a:lnStyleLst>')
  const end = xml.indexOf('</a:lnStyleLst>')
  if (start < 0 || end < 0) throw new Error('theme line list is missing')
  return xml.slice(start, end + '</a:lnStyleLst>'.length)
}

describe('non-solid theme lines survive import and another standalone generation', () => {
  // The source serializer already writes these fills; an importer that only sees solidFill nulls them.
  it.each([
    { kind: 'linear gradient', index: 0 },
    { kind: 'pattern', index: 2 },
    { kind: 'radial gradient', index: 3 },
  ])('keeps the $kind and its line properties through both imports', async ({ index }) => {
    const first = await importPptx(await createPptx(nonSolidLineDocument()))
    expect(Object.values(first.themes ?? {})[0]?.formatScheme?.lineStyles?.[index]).toEqual(supportedLineFills[index])

    const second = await importPptx(await createPptx(first))
    expect(Object.values(second.themes ?? {})[0]?.formatScheme?.lineStyles?.[index]).toEqual(supportedLineFills[index])
  })

  it('does not turn the valid lines into noFill on the second export', async () => {
    const first = await createPptx(nonSolidLineDocument())
    const second = await createPptx(await importPptx(first))

    expect(lineListXml(await themePartOf(second))).toBe(lineListXml(await themePartOf(first)))
  })

  it('keeps a line reference after a null slot on the same patterned line after two generations', async () => {
    const first = await importPptx(await createPptx(nonSolidLineDocument()))
    const second = await importPptx(await createPptx(first))
    const theme = Object.values(second.themes ?? {})[0]
    const lines = theme?.formatScheme?.lineStyles
    expect(lines).toHaveLength(4)
    expect(lines?.[1]).toBeNull()
    const slide = second.slides[second.slideOrder[0]!]
    const shape = second.elements[slide?.elementIds[0] ?? '']
    if (shape?.kind !== 'shape') throw new Error('reimported shape is missing')
    expect(shape.styleRef?.line?.idx).toBe(3)
    expect(resolveStyleLine(shape.styleRef?.line, theme)).toEqual({ rgb: '4472C4', alpha: 100000 })
    expect(resolveStyleLineStroke(shape.styleRef?.line, theme)).toEqual({
      width: 25400, style: { custom: [{ dash: 400000, space: 200000 }] }, cap: 'sq', join: 'round', compound: 'thickThin', align: 'ctr',
    })
  })

  it('leaves source-only line attributes intact when an unrelated theme color changes', async () => {
    const parts = await readZipEntries(await createPptx(nonSolidLineDocument()))
    const themePart = parts.find((entry) => entry.name === 'ppt/theme/theme1.xml')!
    const originalTheme = new TextDecoder().decode(themePart.data)
      .replace('<a:ln w="12700"', "<a:ln data-line='keep' w='012700'")
    themePart.data = new TextEncoder().encode(originalTheme)
    const source = writeStoredZip(parts)
    const imported = await importPptx(source)
    const theme = Object.values(imported.themes ?? {})[0]!
    theme.colors.accent1 = { type: 'srgb', v: 'FF0000' }

    const output = await exportPptx(imported, source)

    expect(await themePartOf(output)).toBe(originalTheme.replace('val="4472C4"', 'val="FF0000"'))
  })
})

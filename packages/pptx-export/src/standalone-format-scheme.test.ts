import { importPptx } from '@ppt4ai/pptx-import'
import { resolveSlideBackground, resolveStyleFill, resolveStyleLine, resolveStyleLineStroke, type Ppt4aiDocument, type Theme } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx } from './index.js'
import { serializeThemeXml } from './standalone-xml.js'
import { readZipEntries } from './zip.js'

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
      lineStyles: [{ ...phClr, width: 6350 }, { ...phClr, width: 12700, style: 'dash' }],
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
    expect(scheme?.lineStyles?.slice(0, 2)).toEqual([{ ...phClr, width: 6350 }, { ...phClr, width: 12700, style: 'dash' }])
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
    expect(resolveStyleLineStroke(shape.styleRef?.line, theme)).toEqual({ width: 12700, style: 'dash' })
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

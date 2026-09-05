import { importPptx } from '@ppt4ai/pptx-import'
import { resolveStyleFillPattern, type Fill, type Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx } from './index.js'
import { serializeFillXml } from './text-xml.js'

const pattern: Fill = {
  color: { type: 'srgb', v: 'FF0000' },
  pattern: {
    preset: 'ltHorz',
    foreground: { type: 'srgb', v: 'FF0000' },
    background: { type: 'srgb', v: '00FF00' },
  },
}

const document: Ppt4aiDocument = {
  format: 'ppt4ai',
  version: 1,
  id: 'dck_pattern',
  page: { w: 12192000, h: 6858000 },
  slides: { sld_1: { id: 'sld_1', elementIds: ['el_shape'], layoutId: 'lyt_1' } },
  slideOrder: ['sld_1'],
  elements: {
    el_shape: {
      id: 'el_shape',
      kind: 'shape',
      preset: 'rect',
      bounds: { x: 1000000, y: 1000000, w: 2000000, h: 1000000 },
      fill: pattern,
      styleRef: { fill: { idx: 2, color: { type: 'scheme', v: 'accent1' } } },
    },
  },
  layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } },
  masters: { mst_1: { id: 'mst_1', themeId: 'theme-1' } },
  themes: {
    'theme-1': {
      id: 'theme-1',
      colors: { accent1: { type: 'srgb', v: '4472C4' } },
      formatScheme: {
        fillStyles: [
          { color: { type: 'scheme', v: 'phClr' } },
          {
            color: { type: 'scheme', v: 'phClr' },
            pattern: {
              preset: 'dkUpDiag',
              foreground: { type: 'scheme', v: 'phClr' },
              background: { type: 'srgb', v: 'FFFFFF' },
            },
          },
        ],
      },
    },
  },
}

describe('pattern fill serialization', () => {
  it('writes the preset attribute and both colour children in order', () => {
    expect(serializeFillXml(pattern)).toBe(
      '<a:pattFill prst="ltHorz">'
      + '<a:fgClr><a:srgbClr val="FF0000"/></a:fgClr>'
      + '<a:bgClr><a:srgbClr val="00FF00"/></a:bgClr>'
      + '</a:pattFill>',
    )
  })

  /** All three are one `EG_FillProperties` choice, so a model stating both still writes one element. */
  it('lets a gradient win over a pattern', () => {
    const both: Fill = {
      ...pattern,
      gradient: { stops: [{ pos: 0, color: { type: 'srgb', v: '000000' } }, { pos: 100000, color: { type: 'srgb', v: 'FFFFFF' } }] },
    }

    expect(serializeFillXml(both)).toContain('<a:gradFill>')
    expect(serializeFillXml(both)).not.toContain('pattFill')
  })

  it('still writes a plain fill as a:solidFill', () => {
    expect(serializeFillXml({ color: { type: 'srgb', v: '123456' } }))
      .toBe('<a:solidFill><a:srgbClr val="123456"/></a:solidFill>')
  })
})

describe('pattern fill round trip', () => {
  it('brings the element pattern back verbatim', async () => {
    const reimported = await importPptx(await createPptx(document))
    const slide = Object.values(reimported.slides)[0]
    const shape = reimported.elements[slide?.elementIds[0] ?? '']
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')

    expect(shape.fill).toEqual(pattern)
  })

  /** Before this the theme entry serialized as `a:noFill`, so the reference came back resolving to nothing. */
  it('brings the theme pattern entry back and resolves phClr through fillRef', async () => {
    const reimported = await importPptx(await createPptx(document))
    const theme = Object.values(reimported.themes ?? {})[0]

    expect(theme?.formatScheme?.fillStyles?.[1]?.pattern).toEqual({
      preset: 'dkUpDiag',
      foreground: { type: 'scheme', v: 'phClr' },
      background: { type: 'srgb', v: 'FFFFFF' },
    })
    expect(resolveStyleFillPattern({ idx: 2, color: { type: 'scheme', v: 'accent1' } }, theme)).toEqual({
      preset: 'dkUpDiag',
      foreground: { rgb: '4472C4', alpha: 100000 },
      background: { rgb: 'FFFFFF', alpha: 100000 },
    })
  })

  it('stays deterministic across repeated exports', async () => {
    expect(await createPptx(document)).toEqual(await createPptx(structuredClone(document)))
  })
})

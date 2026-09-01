import { describe, expect, it } from 'vitest'
import {
  mergeColorMaps,
  fingerprintBytes,
  fingerprintDocument,
  resolveColor,
  resolveInheritedElement,
  resolveTableCellStyle,
  validateDocument,
  validateTextBody,
  type Ppt4aiDocument,
  type ImageElement,
  type TableElement,
  type TableStyle,
  type SlideLayout,
  type SlideMaster,
  type TextElement,
  type Theme,
  type ThemeSource,
  type SlideLayoutSource,
  type SlideMasterSource,
} from './index'

const minimalDocument: Ppt4aiDocument = {
  format: 'ppt4ai',
  version: 1,
  id: 'dck_1',
  page: { w: 12192000, h: 6858000 },
  slides: {
    sld_1: { id: 'sld_1', elementIds: ['el_shape'] },
  },
  elements: {
    el_shape: {
      id: 'el_shape',
      kind: 'shape',
      preset: 'rect',
      bounds: { x: 1000000, y: 1000000, w: 4000000, h: 2000000 },
      fill: { color: { type: 'srgb', v: '4472C4' } },
    },
  },
  slideOrder: ['sld_1'],
}

describe('ppt4ai file model', () => {
  it('creates deterministic fingerprints without mutating byte or document inputs', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const bytesCopy = new Uint8Array(bytes)
    expect(fingerprintBytes(bytes)).toBe(fingerprintBytes(bytesCopy))
    expect(fingerprintBytes(bytes)).not.toBe(fingerprintBytes(new Uint8Array([1, 2, 3, 5])))
    expect(bytes).toEqual(bytesCopy)

    const reordered = {
      slideOrder: minimalDocument.slideOrder,
      elements: minimalDocument.elements,
      slides: minimalDocument.slides,
      page: minimalDocument.page,
      id: minimalDocument.id,
      version: minimalDocument.version,
      format: minimalDocument.format,
    } satisfies Ppt4aiDocument
    expect(fingerprintDocument(minimalDocument)).toBe(fingerprintDocument(reordered))

    const sourced = {
      ...minimalDocument,
      source: { entries: { 'ppt/slides/slide1.xml': '<p:sld/>' }, packageFingerprint: 'pkg', modelFingerprint: 'model' },
    }
    const changed = structuredClone(minimalDocument)
    changed.elements.el_shape!.bounds.x += 1
    expect(fingerprintDocument(sourced)).toBe(fingerprintDocument(minimalDocument))
    expect(fingerprintDocument(changed)).not.toBe(fingerprintDocument(minimalDocument))
  })

  it('validates optional source fingerprints when present', () => {
    const sourced = {
      ...minimalDocument,
      source: { entries: {}, packageFingerprint: 'pkg', modelFingerprint: 'model' },
    }
    expect(validateDocument(sourced)).toEqual({ valid: true })
    expect(validateDocument({ ...sourced, source: { entries: {}, packageFingerprint: '', modelFingerprint: '' } })).toEqual({
      valid: false,
      errors: ['source.packageFingerprint must be a non-empty string', 'source.modelFingerprint must be a non-empty string'],
    })
  })

  it('keeps theme source provenance clone-safe and part of the model fingerprint', () => {
    const source: ThemeSource = { partPath: 'ppt/theme/custom.xml' }
    const withSource: Ppt4aiDocument = {
      ...minimalDocument,
      themes: {
        theme_1: {
          id: 'theme_1',
          colors: { accent1: { type: 'srgb', v: '336699' } },
          source,
        },
      },
    }

    expect(validateDocument(withSource)).toEqual({ valid: true })
    expect(structuredClone(withSource)).toEqual(withSource)
    expect(fingerprintDocument(withSource)).not.toBe(fingerprintDocument(minimalDocument))
  })

  it('rejects invalid theme source provenance', () => {
    const document = {
      ...minimalDocument,
      themes: {
        theme_1: {
          id: 'theme_1',
          colors: {},
          source: { partPath: '' },
        },
      },
    }

    expect(validateDocument(document as Ppt4aiDocument)).toEqual({
      valid: false,
      errors: ['themes.theme_1.source.partPath must be a non-empty string'],
    })
  })

  it('keeps master and layout source bindings clone-safe and fingerprinted', () => {
    const masterSource: SlideMasterSource = { partPath: 'ppt/slideMasters/custom.xml' }
    const layoutSource: SlideLayoutSource = { partPath: 'ppt/slideLayouts/custom.xml' }
    const document = structuredClone(minimalDocument)
    document.masters = { master_1: { id: 'master_1', source: masterSource } }
    document.layouts = { layout_1: { id: 'layout_1', masterId: 'master_1', source: layoutSource } }

    expect(validateDocument(document)).toEqual({ valid: true })
    expect(structuredClone(document)).toEqual(document)
    expect(fingerprintDocument(document)).not.toBe(fingerprintDocument(minimalDocument))
  })

  it('rejects empty master and layout source paths', () => {
    const document = {
      ...minimalDocument,
      masters: { master_1: { id: 'master_1', source: { partPath: '' } } },
      layouts: { layout_1: { id: 'layout_1', masterId: 'master_1', source: { partPath: '' } } },
    }

    expect(validateDocument(document as Ppt4aiDocument)).toEqual({
      valid: false,
      errors: [
        'masters.master_1.source.partPath must be a non-empty string',
        'layouts.layout_1.source.partPath must be a non-empty string',
      ],
    })
  })

  it('resolves structured colors, scheme mapping, and ordered transforms', () => {
    const theme = {
      id: 'theme-1',
      colors: {
        accent1: { type: 'srgb', v: '336699' },
        dk1: { type: 'srgb', v: '202020' },
      },
    } satisfies Theme

    expect(resolveColor({ type: 'scheme', v: 'accent1' }, theme)).toEqual({ rgb: '336699', alpha: 100000 })
    expect(resolveColor({ type: 'srgb', v: '000000', transforms: [{ type: 'tint', value: 50000 }] })).toEqual({ rgb: '808080', alpha: 100000 })
    expect(resolveColor({ type: 'srgb', v: '336699', transforms: [{ type: 'alpha', value: 50000 }, { type: 'alphaOff', value: 10000 }] })).toEqual({ rgb: '336699', alpha: 60000 })
    expect(resolveColor({ type: 'preset', v: 'red' })).toEqual({ rgb: 'FF0000', alpha: 100000 })
    expect(resolveColor({ type: 'system', v: '112233' })).toEqual({ rgb: '112233', alpha: 100000 })
    expect(resolveColor({ type: 'scrgb', v: '100000,50000,0' })).toEqual({ rgb: 'FF8000', alpha: 100000 })
    expect(resolveColor({ type: 'preset', v: 'not-a-preset' })).toBeUndefined()
  })

  it('treats a null theme color as an explicit Office-default reset', () => {
    const theme = {
      id: 'theme-reset',
      colors: { accent1: null },
    } satisfies Theme
    const document = {
      ...minimalDocument,
      themes: { 'theme-reset': theme },
    }

    expect(validateDocument(document)).toEqual({ valid: true })
    expect(resolveColor({ type: 'scheme', v: 'accent1' }, theme)).toEqual({ rgb: '4472C4', alpha: 100000 })
    expect(structuredClone(theme)).toEqual(theme)
    expect(fingerprintDocument(document)).not.toBe(fingerprintDocument(minimalDocument))
  })

  it('resolves recursive scheme colors and rejects unresolved scheme sources', () => {
    const recursiveTheme = {
      id: 'theme-recursive',
      colors: {
        accent1: { type: 'scheme', v: 'accent2' },
        accent2: { type: 'srgb', v: '123456' },
      },
    } satisfies Theme
    const cyclicTheme = {
      id: 'theme-cycle',
      colors: {
        accent1: { type: 'scheme', v: 'accent2' },
        accent2: { type: 'scheme', v: 'accent1' },
      },
    } satisfies Theme

    expect(resolveColor({ type: 'scheme', v: 'accent1' }, recursiveTheme)).toEqual({ rgb: '123456', alpha: 100000 })
    expect(resolveColor({ type: 'scheme', v: 'accent1' }, cyclicTheme)).toBeUndefined()
    expect(resolveColor({ type: 'scheme', v: 'phClr' }, recursiveTheme)).toBeUndefined()
    expect(resolveColor({ type: 'scheme', v: 'accent1' })).toBeUndefined()
  })

  it('stops a scheme cycle before reaching the recursion depth limit', () => {
    let slotReads = 0
    const theme = {
      id: 'theme-cycle-short',
      colors: {
        get accent1() {
          slotReads += 1
          return { type: 'scheme', v: 'accent2' } as const
        },
        get accent2() {
          slotReads += 1
          return { type: 'scheme', v: 'accent1' } as const
        },
      },
    } satisfies Theme

    expect(resolveColor({ type: 'scheme', v: 'accent1' }, theme)).toBeUndefined()
    expect(slotReads).toBe(2)
  })

  it('applies master, layout, and slide color-map overlays in order', () => {
    expect(mergeColorMaps({ accent1: 'accent1' }, { accent1: 'accent2' }, { accent1: 'accent3' }).accent1).toBe('accent3')
  })

  it('merges table text defaults field by field', () => {
    const table: TableElement = {
      id: 'tbl-1',
      kind: 'table',
      bounds: { x: 0, y: 0, w: 1000, h: 1000 },
      columns: [1000],
      rows: [{ height: 1000, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'Header' }] }] } }] }],
      style: { styleId: 'style-1', firstRow: true },
    }
    const style = {
      id: 'style-1',
      regions: {
        wholeTable: { text: { color: { type: 'srgb', v: '111111' }, bold: false } },
        firstRow: { text: { color: { type: 'srgb', v: 'FFFFFF' }, bold: true, italic: true } },
      },
    } satisfies TableStyle

    expect(resolveTableCellStyle(table, table.rows[0]!.cells[0]!, 0, 0, { 'style-1': style })).toMatchObject({
      text: { color: { type: 'srgb', v: 'FFFFFF' }, bold: true, italic: true },
    })
  })

  it('validates theme colors, mappings, transforms, and table text styles with stable paths', () => {
    const document = {
      ...minimalDocument,
      themes: {
        'theme-1': {
          id: 'theme-1',
          colors: {
            invalidSlot: { type: 'srgb', v: 'FFFFFF' },
            accent1: {
              type: 'srgb',
              v: '336699',
              transforms: [
                { type: 'unknown', value: 50000 },
                { type: 'tint', value: -1 },
              ],
            },
          },
        },
      },
      masters: {
        master_1: { id: 'master_1', colorMap: { accent1: 'invalidSlot' } },
      },
      tableStyles: {
        'style-1': {
          id: 'style-1',
          regions: { wholeTable: { text: { bold: 'yes' } } },
        },
      },
    } as unknown as Ppt4aiDocument

    expect(validateDocument(document)).toEqual({
      valid: false,
      errors: [
        'tableStyles.style-1.regions.wholeTable.text.bold must be a boolean',
        'themes.theme-1.colors.invalidSlot is not a supported theme color slot',
        'themes.theme-1.colors.accent1.transforms[0].type must be a supported color transform type',
        'themes.theme-1.colors.accent1.transforms[1].value must be between 0 and 100000',
        'masters.master_1.colorMap.accent1 must reference a supported theme color slot',
      ],
    })
  })

  it('keeps themes and ordered transforms structured-clone safe', () => {
    const theme = {
      id: 'theme-clone',
      colors: {
        accent1: {
          type: 'srgb',
          v: '336699',
          transforms: [
            { type: 'shade', value: 80000 },
            { type: 'alphaMod', value: 50000 },
          ],
        },
      },
    } satisfies Theme

    expect(structuredClone(theme)).toEqual(theme)
  })

  it('resolves table style regions before explicit cell overrides', () => {
    const emptyBody = () => ({ paragraphs: [{ runs: [] }] })
    const table: TableElement = {
      id: 'tbl_1',
      kind: 'table' as const,
      bounds: { x: 0, y: 0, w: 2000, h: 2000 },
      columns: [1000, 1000],
      rows: [
        { height: 1000, cells: [{ column: 0, body: emptyBody() }, { column: 1, body: emptyBody() }] },
        { height: 1000, cells: [{ column: 0, body: emptyBody() }, { column: 1, body: emptyBody(), fill: { color: { type: 'srgb', v: '00FF00' } } }] },
      ],
      style: { styleId: 'style-1', bandRow: true, firstRow: true, firstColumn: true },
    }
    const style: TableStyle = {
      id: 'style-1',
      regions: {
        wholeTable: { fill: { color: { type: 'srgb', v: 'FFFFFF' } }, borders: { bottom: { color: { type: 'srgb', v: '111111' }, width: 1000, style: 'solid' as const } } },
        band1H: { fill: { color: { type: 'srgb', v: 'EEEEEE' } } },
        firstRow: { fill: { color: { type: 'srgb', v: 'FF0000' } } },
        firstCol: { borders: { left: { color: { type: 'srgb', v: '0000FF' }, width: 2000, style: 'dash' as const } } },
      },
    }

    expect(validateDocument({
      ...minimalDocument,
      slides: { sld_1: { id: 'sld_1', elementIds: ['tbl_1'] } },
      elements: { tbl_1: table },
      tableStyles: { 'style-1': style },
    } as unknown as Ppt4aiDocument)).toEqual({ valid: true })
    expect(structuredClone(style)).toEqual(style)
    expect(resolveTableCellStyle(table, table.rows[0]!.cells[0]!, 0, 0, { 'style-1': style })).toEqual({
      fill: { color: { type: 'srgb', v: 'FF0000' } },
      borders: {
        bottom: { color: { type: 'srgb', v: '111111' }, width: 1000, style: 'solid' },
        left: { color: { type: 'srgb', v: '0000FF' }, width: 2000, style: 'dash' },
      },
    })
    expect(resolveTableCellStyle(table, table.rows[1]!.cells[1]!, 1, 1, { 'style-1': style })).toEqual({
      fill: { color: { type: 'srgb', v: '00FF00' } },
      borders: { bottom: { color: { type: 'srgb', v: '111111' }, width: 1000, style: 'solid' } },
    })
    expect(resolveTableCellStyle({ ...table, style: { styleId: 'missing' } }, table.rows[0]!.cells[0]!, 0, 0, {})).toEqual({ borders: {} })
  })

  it('reports stable paths for invalid table style semantics', () => {
    const table = {
      id: 'tbl_1', kind: 'table', bounds: { x: 0, y: 0, w: 1000, h: 1000 }, columns: [1000],
      rows: [{ height: 1000, cells: [{ column: 0, body: { paragraphs: [{ runs: [] }] } }] }],
      style: { styleId: '', firstRow: 'yes' },
    } as unknown as TableElement
    expect(validateDocument({
      ...minimalDocument,
      slides: { sld_1: { id: 'sld_1', elementIds: ['tbl_1'] } },
      elements: { tbl_1: table },
      tableStyles: { style_1: { id: 'style_1', regions: { unsupported: {} } } as unknown as TableStyle },
    } as unknown as Ppt4aiDocument)).toEqual({
      valid: false,
      errors: [
        'tableStyles.style_1.regions.unsupported is not a supported table style region',
        'elements.tbl_1.style.styleId must be a non-empty string',
        'elements.tbl_1.style.firstRow must be a boolean',
      ],
    })
  })

  it('validates table grid spans, cell bodies, borders, and clone safety', () => {
    const tableDocument = {
      ...minimalDocument,
      slides: { sld_1: { id: 'sld_1', elementIds: ['tbl_1'] } },
      elements: {
        tbl_1: {
          id: 'tbl_1',
          kind: 'table',
          bounds: { x: 100, y: 200, w: 3000, h: 2000 },
          columns: [1000, 2000],
          rows: [{
            height: 1000,
            cells: [{
              column: 0,
              colSpan: 2,
              body: { paragraphs: [{ runs: [{ text: 'A' }] }] },
              borders: {
                left: { color: { type: 'srgb', v: '000000' }, width: 1, style: 'solid' },
              },
            }],
          }, {
            height: 1000,
            cells: [
              { column: 0, body: { paragraphs: [{ runs: [{ text: 'B' }] }] } },
              { column: 1, body: { paragraphs: [{ runs: [{ text: 'C' }] }] } },
            ],
          }],
        },
      },
    } as unknown as Ppt4aiDocument

    expect(validateDocument(tableDocument)).toEqual({ valid: true })
    expect(structuredClone(tableDocument)).toEqual(tableDocument)

    const broken = structuredClone(tableDocument) as unknown as Record<string, any>
    broken.elements.tbl_1.columns = [0, 2000]
    broken.elements.tbl_1.rows[0].cells[0].colSpan = 3
    broken.elements.tbl_1.rows[1].cells[0].column = 0.5
    broken.elements.tbl_1.rows[1].cells[1].borders = {
      top: { color: { type: 'srgb', v: '000000' }, width: -1, style: 'wavy' },
    }

    expect(validateDocument(broken as Ppt4aiDocument)).toEqual({
      valid: false,
      errors: [
        'elements.tbl_1.columns[0] must be positive',
        'elements.tbl_1.rows[0].cells[0] exceeds table columns',
        'elements.tbl_1.rows[1].cells[0].column must be a non-negative integer',
        'elements.tbl_1.rows[1].cells[1].borders.top.width must be non-negative',
        'elements.tbl_1.rows[1].cells[1].borders.top.style must be solid, dash, dot, or none',
      ],
    })
  })

  it('validates explicit table cell fills', () => {
    const table = {
      id: 'tbl_1',
      kind: 'table',
      bounds: { x: 0, y: 0, w: 1000, h: 1000 },
      columns: [1000],
      rows: [{ height: 1000, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'A' }] }] }, fill: { color: { type: 'invalid', v: '' } } }] }],
    } as unknown as TableElement

    expect(validateDocument({
      ...minimalDocument,
      slides: { sld_1: { id: 'sld_1', elementIds: ['tbl_1'] } },
      elements: { tbl_1: table },
    } as unknown as Ppt4aiDocument)).toEqual({
      valid: false,
      errors: [
        'elements.tbl_1.rows[0].cells[0].fill.color.type must be a supported color type',
        'elements.tbl_1.rows[0].cells[0].fill.color.v must be a non-empty string',
      ],
    })
  })

  it('rejects table row spans that exceed rows or overlap occupied cells', () => {
    const baseTable: any = {
      id: 'tbl_1',
      kind: 'table' as const,
      bounds: { x: 0, y: 0, w: 2000, h: 2000 },
      columns: [1000, 1000],
      rows: [
        { height: 1000, cells: [{ column: 0, rowSpan: 2, body: { paragraphs: [{ runs: [{ text: 'A' }] }] } }] },
        { height: 1000, cells: [{ column: 1, body: { paragraphs: [{ runs: [{ text: 'B' }] }] } }] },
      ],
    }
    const overflow = structuredClone(baseTable)
    overflow.rows[0].cells[0]!.rowSpan = 3
    const overlap = structuredClone(baseTable)
    overlap.rows[1].cells[0]!.column = 0

    expect(validateDocument({ ...minimalDocument, slides: { sld_1: { id: 'sld_1', elementIds: ['tbl_1'] } }, elements: { tbl_1: overflow } })).toEqual({
      valid: false,
      errors: ['elements.tbl_1.rows[0].cells[0] exceeds table rows'],
    })
    expect(validateDocument({ ...minimalDocument, slides: { sld_1: { id: 'sld_1', elementIds: ['tbl_1'] } }, elements: { tbl_1: overlap } })).toEqual({
      valid: false,
      errors: ['elements.tbl_1.rows[1].cells[0] overlaps another cell'],
    })
  })

  it('accepts JSON-safe text bodies and body-only text elements', () => {
    const body = {
      bodyPr: {
        insets: { left: 100, top: 200, right: 300, bottom: 400 },
        verticalAlign: 'middle' as const,
        wrap: 'square' as const,
        autofit: { type: 'shrink' as const, minFontScale: 60000 },
      },
      paragraphs: [{
        attrs: { align: 'center' as const, level: 1, lineSpacing: 120000, spaceAfter: 500 },
        runs: [{ text: 'Hello', marks: { fontFamily: 'Arial', fontSize: 20, bold: true } }],
      }],
    }
    const element: TextElement = {
      id: 'el_text',
      kind: 'text',
      bounds: { x: 0, y: 0, w: 1000, h: 1000 },
      body,
    }

    expect(validateTextBody(body)).toEqual({ valid: true })
    expect(structuredClone(element)).toEqual(element)
  })

  it('accepts horizontal and vertical writing modes as clone-safe body properties', () => {
    const vertical = { bodyPr: { vertical: 'vertical' as const }, paragraphs: [{ runs: [{ text: '中文' }] }] }
    const horizontal = { bodyPr: { vertical: 'horizontal' as const }, paragraphs: [{ runs: [{ text: 'text' }] }] }

    expect(validateTextBody(vertical)).toEqual({ valid: true })
    expect(validateTextBody(horizontal)).toEqual({ valid: true })
    expect(structuredClone(vertical)).toEqual(vertical)
  })

  it('reports a deterministic path for invalid writing modes', () => {
    expect(validateTextBody({
      bodyPr: { vertical: 'diagonal' },
      paragraphs: [{ runs: [{ text: 'invalid' }] }],
    })).toEqual({
      valid: false,
      errors: ['bodyPr.vertical must be horizontal or vertical'],
    })
    expect(validateTextBody({
      bodyPr: { vertical: 90 },
      paragraphs: [{ runs: [{ text: 'invalid' }] }],
    })).toEqual({
      valid: false,
      errors: ['bodyPr.vertical must be horizontal or vertical'],
    })
  })

  it('accepts clone-safe character and automatic numbering bullets', () => {
    const body = {
      paragraphs: [
        { attrs: { bullet: { type: 'char' as const, char: '•', fontFamily: 'Arial' }, level: 0 }, runs: [{ text: 'one' }] },
        { attrs: { bullet: { type: 'autoNum' as const, scheme: 'arabic' as const, startAt: 3 }, level: 0 }, runs: [{ text: 'three' }] },
        { attrs: { bullet: { type: 'autoNum' as const, scheme: 'alphaLower' as const }, level: 1 }, runs: [{ text: 'a' }] },
        { attrs: { bullet: { type: 'autoNum' as const, scheme: 'alphaUpper' as const } }, runs: [{ text: 'A' }] },
      ],
    }

    expect(validateTextBody(body)).toEqual({ valid: true })
    expect(structuredClone(body)).toEqual(body)
  })

  it('reports deterministic bullet validation paths', () => {
    expect(validateTextBody({
      paragraphs: [{
        attrs: {
          bullet: { type: 'char', char: 'ab', fontFamily: '' },
          level: 1.5,
        },
        runs: [{ text: 'invalid' }],
      }, {
        attrs: { bullet: { type: 'autoNum', scheme: 'roman', startAt: 0 } },
        runs: [{ text: 'invalid' }],
      }],
    })).toEqual({
      valid: false,
      errors: [
        'paragraphs[0].attrs.level must be non-negative integer',
        'paragraphs[0].attrs.bullet.char must contain exactly one Unicode code point',
        'paragraphs[0].attrs.bullet.fontFamily must be non-empty',
        'paragraphs[1].attrs.bullet.scheme must be arabic, alphaLower, or alphaUpper',
        'paragraphs[1].attrs.bullet.startAt must be a positive integer',
      ],
    })
  })

  it('reports deterministic paths for invalid text body values', () => {
    expect(validateTextBody({
      bodyPr: {
        insets: { left: -1, top: 0, right: 0, bottom: 0 },
        autofit: { type: 'shrink', minFontScale: 0 },
      },
      paragraphs: [{
        attrs: { level: -1, lineSpacing: 0, spaceBefore: -1 },
        runs: [{ text: '', marks: { fontSize: 0, baseline: Number.NaN } }],
      }],
    })).toEqual({
      valid: false,
      errors: [
        'paragraphs[0].runs[0].text must be non-empty',
        'paragraphs[0].runs[0].marks.fontSize must be positive',
        'paragraphs[0].runs[0].marks.baseline must be finite',
        'paragraphs[0].attrs.level must be non-negative integer',
        'paragraphs[0].attrs.spaceBefore must be non-negative',
        'paragraphs[0].attrs.lineSpacing must be positive',
        'bodyPr.insets.left must be non-negative',
        'bodyPr.autofit.minFontScale must be between 1 and 100000',
      ],
    })
  })

  it('requires at least one paragraph and validates resize maximum height', () => {
    expect(validateTextBody({ bodyPr: { autofit: { type: 'resize', maxHeight: -1 } }, paragraphs: [] })).toEqual({
      valid: false,
      errors: [
        'paragraphs must be non-empty',
        'bodyPr.autofit.maxHeight must be positive',
      ],
    })
  })

  it('accepts a minimal JSON file and rejects broken slide order', () => {
    expect(validateDocument(minimalDocument)).toEqual({ valid: true })
    expect(validateDocument({ ...minimalDocument, slideOrder: ['missing'] })).toEqual({
      valid: false,
      errors: ['slideOrder references missing slide: missing'],
    })
  })

  it('accepts OOXML rotations on shape and text elements', () => {
    const document = structuredClone(minimalDocument)
    const shape = document.elements.el_shape
    if (!shape || shape.kind !== 'shape') throw new Error('shape fixture is missing')
    shape.rotation = -5400000
    document.elements.el_text = {
      id: 'el_text',
      kind: 'text',
      bounds: { x: 200, y: 300, w: 400, h: 500 },
      text: 'Rotated',
      rotation: 2700000,
    }
    document.slides.sld_1!.elementIds = ['el_shape', 'el_text']

    expect(validateDocument(document)).toEqual({ valid: true })
    expect(structuredClone(document)).toEqual(document)
  })

  it('accepts an OOXML rotation on a table element', () => {
    const document = structuredClone(minimalDocument)
    document.elements.el_table = {
      id: 'el_table',
      kind: 'table',
      bounds: { x: 100, y: 200, w: 900, h: 400 },
      columns: [900],
      rows: [{ height: 400, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'Cell' }] }] } }] }],
      rotation: 1200000,
    }
    document.slides.sld_1!.elementIds = ['el_shape', 'el_table']

    expect(validateDocument(document)).toEqual({ valid: true })
  })

  it('reports a stable path for an invalid table rotation', () => {
    const document = structuredClone(minimalDocument)
    document.elements.el_table = {
      id: 'el_table',
      kind: 'table',
      bounds: { x: 100, y: 200, w: 900, h: 400 },
      columns: [900],
      rows: [{ height: 400, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'Cell' }] }] } }] }],
      rotation: 0.5,
    }
    document.slides.sld_1!.elementIds = ['el_shape', 'el_table']

    expect(validateDocument(document)).toEqual({
      valid: false,
      errors: ['elements.el_table.rotation must be an integer'],
    })
  })

  it('reports stable paths for invalid shape and text rotations', () => {
    const document = structuredClone(minimalDocument) as Ppt4aiDocument & {
      elements: Record<string, Ppt4aiDocument['elements'][string] & { rotation?: unknown }>
    }
    const shape = document.elements.el_shape
    if (!shape) throw new Error('shape fixture is missing')
    shape.rotation = 1.5
    document.elements.el_text = {
      id: 'el_text',
      kind: 'text',
      bounds: { x: 200, y: 300, w: 400, h: 500 },
      text: 'Invalid',
      rotation: Number.NaN,
    } as Ppt4aiDocument['elements'][string] & { rotation?: unknown }
    document.slides.sld_1!.elementIds = ['el_shape', 'el_text']

    expect(validateDocument(document)).toEqual({
      valid: false,
      errors: [
        'elements.el_shape.rotation must be an integer',
        'elements.el_text.rotation must be an integer',
      ],
    })
  })

  it('reports stable paths for invalid placeholder default rotations', () => {
    const document = {
      ...minimalDocument,
      masters: {
        master_1: {
          id: 'master_1',
          defaults: { title: { rotation: 1.5 } },
        },
      },
      layouts: {
        layout_1: {
          id: 'layout_1',
          masterId: 'master_1',
          defaults: { title: { rotation: Number.NaN } },
        },
      },
    } as unknown as Ppt4aiDocument

    expect(validateDocument(document)).toEqual({
      valid: false,
      errors: [
        'masters.master_1.defaults.title.rotation must be an integer',
        'layouts.layout_1.defaults.title.rotation must be an integer',
      ],
    })
  })

  it('accepts image assets and keeps their metadata clone-safe', () => {
    const image: ImageElement = {
      id: 'img_1',
      kind: 'image',
      bounds: { x: 100, y: 200, w: 300, h: 400 },
      assetId: 'asset_1',
      transform: { rotation: 5400000, flipH: true, flipV: false },
      sourceCrop: { left: 1000, top: 2000, right: 3000, bottom: 4000 },
      maskPreset: 'ellipse',
      effects: [{ type: 'alphaModFix', amount: 50000 }, { type: 'grayscl' }],
    }
    const document = {
      ...minimalDocument,
      slides: { sld_1: { id: 'sld_1', elementIds: ['img_1'] } },
      elements: { img_1: image },
      assets: {
        asset_1: {
          id: 'asset_1',
          mimeType: 'image/png' as const,
          pixelWidth: 12,
          pixelHeight: 34,
          originalFilename: 'photo.png',
        },
      },
    }

    expect(validateDocument(document)).toEqual({ valid: true })
    expect(structuredClone(document)).toEqual(document)
  })

  it('reports stable paths for invalid image appearance values', () => {
    const broken = {
      ...minimalDocument,
      slides: { sld_1: { id: 'sld_1', elementIds: ['img_1'] } },
      elements: {
        img_1: {
          id: 'img_1',
          kind: 'image' as const,
          bounds: { x: 0, y: 0, w: 100, h: 100 },
          assetId: 'asset_1',
          transform: { rotation: 1.5, flipH: 'yes', flipV: false },
          sourceCrop: { left: -1, top: 100001, right: 50000.5, bottom: 0 },
          maskPreset: 'hexagon',
          effects: [
            { type: 'alphaModFix', amount: 100001 },
            { type: 'unsupported' },
          ],
        },
      },
      assets: { asset_1: { id: 'asset_1', mimeType: 'image/png' as const } },
    }

    expect(validateDocument(broken as unknown as Ppt4aiDocument)).toEqual({
      valid: false,
      errors: [
        'elements.img_1.transform.rotation must be an integer',
        'elements.img_1.transform.flipH must be a boolean',
        'elements.img_1.sourceCrop.left must be between 0 and 100000',
        'elements.img_1.sourceCrop.top must be between 0 and 100000',
        'elements.img_1.sourceCrop.right must be between 0 and 100000',
        'elements.img_1.maskPreset must be a supported image mask preset',
        'elements.img_1.effects[0].amount must be between 0 and 100000',
        'elements.img_1.effects[1].type must be a supported image effect type',
      ],
    })
  })

  it('reports invalid image asset metadata and references', () => {
    const broken = {
      ...minimalDocument,
      slides: { sld_1: { id: 'sld_1', elementIds: ['img_1'] } },
      elements: {
        img_1: {
          id: 'img_1',
          kind: 'image' as const,
          bounds: { x: 0, y: 0, w: 0, h: 10 },
          assetId: 'missing',
        },
      },
      assets: {
        asset_1: {
          id: 'wrong',
          mimeType: 'image/tiff',
          pixelWidth: 0,
          pixelHeight: -1,
          originalFilename: '',
        },
      },
    }

    expect(validateDocument(broken as unknown as Ppt4aiDocument)).toEqual({
      valid: false,
      errors: [
        'assets.asset_1.id must match asset key',
        'assets.asset_1.mimeType must be a supported image MIME type',
        'assets.asset_1.pixelWidth must be positive',
        'assets.asset_1.pixelHeight must be positive',
        'assets.asset_1.originalFilename must be a non-empty string',
        'element img_1 bounds must be positive',
        'image element img_1 references missing asset: missing',
      ],
    })
  })

  it('keeps the contract structured-clone safe', () => {
    expect(structuredClone(minimalDocument)).toEqual(minimalDocument)
  })

  it('validates optional slide source provenance', () => {
    const sourced = {
      ...minimalDocument,
      slides: {
        sld_1: {
          ...minimalDocument.slides.sld_1!,
          source: {
            originId: 'sld_1',
            partPath: 'ppt/slides/slide1.xml',
            relationshipId: 'rId1',
            presentationId: '256',
          },
        },
      },
    }

    expect(validateDocument(sourced)).toEqual({ valid: true })
    expect(validateDocument({
      ...sourced,
      slides: {
        sld_1: {
          ...sourced.slides.sld_1,
          source: { ...sourced.slides.sld_1.source, partPath: '', relationshipId: '' },
        },
      },
    })).toEqual({
      valid: false,
      errors: [
        'slide sld_1 source.partPath must be a non-empty string',
        'slide sld_1 source.relationshipId must be a non-empty string',
      ],
    })
  })

  it('reports duplicate and dangling element references', () => {
    const broken = {
      ...minimalDocument,
      slides: {
        sld_1: { id: 'sld_1', elementIds: ['el_shape', 'el_shape', 'missing'] },
      },
    }

    expect(validateDocument(broken)).toEqual({
      valid: false,
      errors: [
        'slide sld_1 references duplicate element: el_shape',
        'slide sld_1 references missing element: missing',
      ],
    })
  })

  it('resolves explicit properties over layout and master defaults', () => {
    const element = {
      id: 'el_title',
      kind: 'text' as const,
      bounds: { x: 1, y: 2, w: 3, h: 4 },
      text: 'Slide title',
      placeholder: 'title',
    }
    const master: SlideMaster = {
      id: 'master_1',
      defaults: { title: { fill: { color: { type: 'srgb', v: '000000' } } } },
    }
    const layout: SlideLayout = {
      id: 'layout_1',
      masterId: 'master_1',
      defaults: { title: { fill: { color: { type: 'srgb', v: 'FFFFFF' } } } },
    }

    expect(resolveInheritedElement(element, layout, master)).toMatchObject({
      fill: { color: { type: 'srgb', v: 'FFFFFF' } },
    })
    expect(resolveInheritedElement({ ...element, fill: { color: { type: 'srgb', v: 'FF0000' } } }, layout, master)).toMatchObject({
      fill: { color: { type: 'srgb', v: 'FF0000' } },
    })
    const resolved = resolveInheritedElement(element, layout, master)
    expect(structuredClone(resolved)).toEqual(resolved)
  })

  it('validates flat groups and their child references', () => {
    const grouped = {
      ...minimalDocument,
      slides: { sld_1: { id: 'sld_1', elementIds: ['grp_1'] } },
      elements: {
        ...minimalDocument.elements,
        el_b: {
          id: 'el_b',
          kind: 'shape' as const,
          preset: 'ellipse' as const,
          bounds: { x: 6000000, y: 1000000, w: 1000000, h: 1000000 },
        },
        grp_1: {
          id: 'grp_1',
          kind: 'group' as const,
          bounds: { x: 1000000, y: 1000000, w: 6000000, h: 2000000 },
          childIds: ['el_shape', 'el_b'],
        },
      },
    }
    expect(validateDocument(grouped)).toEqual({ valid: true })
    expect(validateDocument({ ...grouped, elements: { ...grouped.elements, grp_1: { ...grouped.elements.grp_1, childIds: ['el_shape', 'el_shape'] } } })).toEqual({
      valid: false,
      errors: ['group grp_1 references duplicate child: el_shape'],
    })
  })

  it('rejects cyclic group references', () => {
    const cyclic = {
      ...minimalDocument,
      slides: { sld_1: { id: 'sld_1', elementIds: ['grp_a'] } },
      elements: {
        ...minimalDocument.elements,
        grp_a: {
          id: 'grp_a',
          kind: 'group' as const,
          bounds: { x: 0, y: 0, w: 100, h: 100 },
          childIds: ['grp_b'],
        },
        grp_b: {
          id: 'grp_b',
          kind: 'group' as const,
          bounds: { x: 0, y: 0, w: 100, h: 100 },
          childIds: ['grp_a'],
        },
      },
    }

    expect(validateDocument(cyclic)).toEqual({
      valid: false,
      errors: ['group cycle detected: grp_a -> grp_b -> grp_a'],
    })
  })
})

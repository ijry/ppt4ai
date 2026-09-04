import { describe, expect, it } from 'vitest'
import type { TextElement } from '@ppt4ai/model'
import { layoutText, measureText, normalizeTextElement, TextModelError } from './index'
import type { TextBody } from '@ppt4ai/model'

const bounds = { x: 0, y: 0, w: 1000000, h: 1000000 }

describe('text normalization', () => {
  it('splits legacy line breaks into paragraphs and preserves empty lines', () => {
    const element: TextElement = { id: 'text_1', kind: 'text', bounds, text: 'A\n\n中文' }

    expect(normalizeTextElement(element)).toEqual({
      paragraphs: [
        { runs: [{ text: 'A' }] },
        { runs: [] },
        { runs: [{ text: '中文' }] },
      ],
    })
  })

  it('uses body as the authoritative source and returns a clone', () => {
    const element: TextElement = {
      id: 'text_1',
      kind: 'text',
      bounds,
      text: 'legacy',
      body: {
        bodyPr: { wrap: 'none' },
        paragraphs: [{ runs: [{ text: 'body', marks: { fontSize: 24 } }] }],
      },
    }

    const normalized = normalizeTextElement(element)
    expect(normalized).toEqual(element.body)
    expect(normalized).not.toBe(element.body)
    expect(normalized.paragraphs[0]).not.toBe(element.body?.paragraphs[0])
    expect(structuredClone(normalized)).toEqual(normalized)
  })

  it('normalizes empty legacy text to one empty paragraph', () => {
    expect(normalizeTextElement({ id: 'text_1', kind: 'text', bounds, text: '' })).toEqual({
      paragraphs: [{ runs: [] }],
    })
  })

  it('throws path-bearing model errors for missing or invalid content', () => {
    expect(() => normalizeTextElement({ id: 'text_1', kind: 'text', bounds })).toThrowError(
      new TextModelError(['text element must define body or text']),
    )
    expect(() => normalizeTextElement({
      id: 'text_1',
      kind: 'text',
      bounds,
      body: { paragraphs: [{ runs: [{ text: '' }] }] },
    })).toThrowError(new TextModelError(['paragraphs[0].runs[0].text must be non-empty']))
  })
})

describe('deterministic text measurement', () => {
  it.each([
    ['A0', 283464],
    ['az', 246888],
    [' ', 64008],
    ['!?', 173736],
    ['中文', 457200],
    ['😀', 228600],
    ['Ω', 137160],
  ])('measures %s with stable category metrics', (text, expected) => {
    expect(measureText(text)).toBe(expected)
  })

  it('applies font size and integer font scale deterministically', () => {
    expect(measureText('A', { fontFamily: 'Any', fontSize: 20 }, 50000)).toBe(78740)
  })
})

function layoutBody(text: string, bodyPr: TextBody['bodyPr'] = {}, width = 1000000, height = 1000000): ReturnType<typeof layoutText> {
  return layoutText({
    bounds: { x: 100000, y: 200000, w: width, h: height },
    body: { bodyPr, paragraphs: [{ runs: [{ text }] }] },
  })
}

describe('deterministic text layout', () => {
  it('lays out vertical text in right-to-left columns with deterministic cell orientation', () => {
    const layout = layoutText({
      bounds: { x: 0, y: 0, w: 1000000, h: 400000 },
      body: {
        bodyPr: { vertical: 'vertical' },
        paragraphs: [{ runs: [{ text: '中文A1，' }] }],
      },
    })

    expect(layout.vertical).toBe('vertical')
    expect(layout.lines.length).toBeGreaterThan(1)
    expect(layout.lines[0]?.x).toBeGreaterThan(layout.lines[1]?.x ?? 0)
    expect(layout.lines.flatMap((line) => line.runs).map((run) => run.text).join('')).toBe('中文A1，')
    expect(layout.lines.flatMap((line) => line.runs).map((run) => ({ text: run.text, orientation: run.orientation }))).toEqual([
      { text: '中', orientation: 'upright' },
      { text: '文', orientation: 'upright' },
      { text: 'A', orientation: 'rotated' },
      { text: '1', orientation: 'rotated' },
      { text: '，', orientation: 'upright' },
    ])
  })

  it('continues vertical automatic numbering without adding marker text to runs', () => {
    const layout = layoutText({
      bounds: { x: 0, y: 0, w: 1000000, h: 1000000 },
      body: {
        bodyPr: { vertical: 'vertical' },
        paragraphs: [
          { runs: [{ text: 'A' }], attrs: { bullet: { type: 'autoNum', scheme: 'arabicPeriod', startAt: 3 } } },
          { runs: [{ text: 'B' }], attrs: { bullet: { type: 'autoNum', scheme: 'arabicPeriod' } } },
        ],
      },
    })

    expect(layout.lines.map((line) => line.marker?.text)).toEqual(['3. ', '4. '])
    expect(layout.lines.flatMap((line) => line.runs).map((run) => run.text).join('')).toBe('AB')
  })

  it('keeps empty vertical paragraphs addressable and reports no-wrap overflow', () => {
    const empty = layoutText({
      bounds: { x: 0, y: 0, w: 1000000, h: 1000000 },
      body: { bodyPr: { vertical: 'vertical' }, paragraphs: [{ runs: [] }] },
    })
    expect(empty.lines).toHaveLength(1)
    expect(empty.lines[0]?.runs).toEqual([])

    const noWrap = layoutText({
      bounds: { x: 0, y: 0, w: 1000000, h: 300000 },
      body: { bodyPr: { vertical: 'vertical', wrap: 'none' }, paragraphs: [{ runs: [{ text: '中文' }] }] },
    })
    expect(noWrap.lines).toHaveLength(1)
    expect(noWrap.overflow).toBe(true)
  })

  it('aligns vertical columns on the cross-axis', () => {
    const top = layoutBody('A', { vertical: 'vertical', verticalAlign: 'top' }, 1000000, 1000000)
    const bottom = layoutBody('A', { vertical: 'vertical', verticalAlign: 'bottom' }, 1000000, 1000000)

    expect(bottom.lines[0]?.x).toBeLessThan(top.lines[0]?.x ?? 0)
  })

  it('renders a character marker outside text runs and aligns wrapped content', () => {
    const layout = layoutText({
      bounds: { x: 0, y: 0, w: 1000000, h: 1000000 },
      body: {
        paragraphs: [{
          runs: [{ text: 'one two three' }],
          attrs: { bullet: { type: 'char', char: '•' } },
        }],
      },
    })

    expect(layout.lines[0]?.marker).toEqual({ text: '• ', x: 0, width: measureText('• ') })
    expect(layout.lines[0]?.runs.map((run) => run.text).join('')).not.toContain('•')
    expect(layout.lines[0]?.marker?.x).toBeLessThan(layout.lines[0]?.x ?? 0)
    expect(layout.lines.slice(1).every((line) => line.marker === undefined)).toBe(true)
    expect(layout.lines.slice(1).every((line) => line.x === layout.lines[0]?.x)).toBe(true)
    expect(layout.contentBounds.w).toBeGreaterThan(layout.lines[0]?.width ?? 0)
  })

  it('continues and resets numbered lists deterministically', () => {
    const arabic = layoutText({
      bounds,
      body: {
        paragraphs: [
          { runs: [{ text: 'A' }], attrs: { bullet: { type: 'autoNum', scheme: 'arabicPeriod', startAt: 3 } } },
          { runs: [{ text: 'B' }], attrs: { bullet: { type: 'autoNum', scheme: 'arabicPeriod' } } },
          { runs: [{ text: 'C' }] },
          { runs: [{ text: 'D' }], attrs: { bullet: { type: 'autoNum', scheme: 'arabicPeriod' } } },
        ],
      },
    })
    // The token says `Period`, so the marker finally carries one — three model families could not.
    expect(arabic.lines.map((line) => line.marker?.text)).toEqual(['3. ', '4. ', undefined, '1. '])

    const lower = layoutText({
      bounds,
      body: {
        paragraphs: Array.from({ length: 27 }, (_, index) => ({
          runs: [{ text: String(index + 1) }],
          attrs: { bullet: { type: 'autoNum', scheme: 'alphaLcPeriod' as const } },
        })),
      },
    })
    expect(lower.lines[0]?.marker?.text).toBe('a. ')
    expect(lower.lines[25]?.marker?.text).toBe('z. ')
    expect(lower.lines[26]?.marker?.text).toBe('aa. ')

    const nested = layoutText({
      bounds,
      body: {
        paragraphs: [
          { runs: [{ text: 'A' }], attrs: { level: 0, bullet: { type: 'autoNum', scheme: 'arabicPeriod' } } },
          { runs: [{ text: 'B' }], attrs: { level: 1, bullet: { type: 'autoNum', scheme: 'arabicPeriod' } } },
          { runs: [{ text: 'C' }], attrs: { level: 1, bullet: { type: 'autoNum', scheme: 'arabicPeriod' } } },
          { runs: [{ text: 'D' }], attrs: { level: 0, bullet: { type: 'autoNum', scheme: 'arabicPeriod' } } },
        ],
      },
    })
    expect(nested.lines.map((line) => line.marker?.text)).toEqual(['1. ', '1. ', '2. ', '2. '])
  })

  it('supports marker-only paragraphs, bullet fonts, alignment, and autofit scaling', () => {
    const markerOnly = layoutText({
      bounds,
      body: { paragraphs: [{ runs: [], attrs: { bullet: { type: 'char', char: '•', fontFamily: 'Wingdings' } } }] },
    })
    expect(markerOnly.lines[0]?.runs).toEqual([])
    expect(markerOnly.lines[0]?.marker).toEqual({ text: '• ', x: 0, width: measureText('• ', { fontFamily: 'Wingdings' }) , marks: { fontFamily: 'Wingdings' } })

    const normal = layoutText({
      bounds: { x: 0, y: 0, w: 1000000, h: 400000 },
      body: { paragraphs: [{ runs: [{ text: 'A' }], attrs: { bullet: { type: 'char', char: '•' } } }, { runs: [{ text: 'B' }] }] },
    })
    const shrink = layoutText({
      bounds: { x: 0, y: 0, w: 1000000, h: 400000 },
      body: { bodyPr: { autofit: { type: 'shrink', minFontScale: 50000 } }, paragraphs: [{ runs: [{ text: 'A' }], attrs: { bullet: { type: 'char', char: '•' } } }, { runs: [{ text: 'B' }] }] },
    })
    const centered = layoutText({
      bounds,
      body: { paragraphs: [{ runs: [{ text: 'A' }], attrs: { align: 'center', bullet: { type: 'char', char: '•' } } }] },
    })
    expect(shrink.fontScale).toBeLessThan(normal.fontScale)
    expect(shrink.lines[0]?.marker?.width).toBeLessThan(normal.lines[0]?.marker?.width ?? 0)
    expect(centered.lines[0]?.marker?.x).toBe(0)
    expect(centered.lines[0]?.x).toBeGreaterThan(0)
  })

  it('creates explicit paragraph lines and preserves run marks', () => {
    const layout = layoutText({
      bounds,
      body: {
        paragraphs: [
          { runs: [{ text: 'Hello', marks: { bold: true } }] },
          { runs: [{ text: '中文', marks: { color: { color: { type: 'srgb', v: 'FF0000' } } } }] },
        ],
      },
    })

    expect(layout.lines).toHaveLength(2)
    expect(layout.lines[0]?.runs).toEqual([{ text: 'Hello', x: 0, width: 635508, marks: { bold: true } }])
    expect(layout.lines[1]?.runs[0]?.text).toBe('中文')
    expect(layout.lines[1]?.paragraphIndex).toBe(1)
  })

  it('wraps CJK by character and Latin text by words', () => {
    const cjk = layoutBody('中文测试', {}, 500000)
    const latin = layoutBody('one two three', {}, 850000)

    expect(cjk.lines.map((line) => line.runs.map((run) => run.text).join(''))).toEqual(['中文', '测试'])
    expect(latin.lines.map((line) => line.runs.map((run) => run.text).join(''))).toEqual(['one two', 'three'])
  })

  it('splits an over-wide Latin word and does not render line-leading spaces', () => {
    const layout = layoutBody('abcdefgh', {}, 300000)

    expect(layout.lines.length).toBeGreaterThan(1)
    expect(layout.lines.every((line) => !line.runs[0]?.text.startsWith(' '))).toBe(true)
    expect(layout.lines.map((line) => line.runs.map((run) => run.text).join('')).join('')).toBe('abcdefgh')
  })

  it('supports no-wrap mode and horizontal alignment', () => {
    const none = layoutBody('one two three', { wrap: 'none' }, 300000)
    const centered = layoutText({
      bounds: { x: 100000, y: 200000, w: 1000000, h: 1000000 },
      body: { paragraphs: [{ runs: [{ text: 'A' }], attrs: { align: 'center' } }] },
    })
    const alignedRight = layoutText({
      bounds: { x: 100000, y: 200000, w: 1000000, h: 1000000 },
      body: { paragraphs: [{ runs: [{ text: 'A' }], attrs: { align: 'right' } }] },
    })

    expect(none.lines).toHaveLength(1)
    expect(none.lines[0]?.width).toBeGreaterThan(300000)
    expect(centered.lines[0]?.x).toBe(529134)
    expect(alignedRight.lines[0]?.x).toBe(958268)
  })

  it('applies paragraph spacing, line spacing, insets, and vertical alignment', () => {
    const top = layoutText({
      bounds: { x: 0, y: 0, w: 1000000, h: 2000000 },
      body: {
        bodyPr: { insets: { left: 100000, top: 100000, right: 100000, bottom: 100000 } },
        paragraphs: [{ runs: [{ text: 'A' }], attrs: { indent: 50000, marginLeft: 25000, lineSpacing: 120000, spaceBefore: 30000, spaceAfter: 40000 } }],
      },
    })
    const middle = layoutText({
      bounds: { x: 0, y: 0, w: 1000000, h: 2000000 },
      body: { bodyPr: { verticalAlign: 'middle' }, paragraphs: [{ runs: [{ text: 'A' }] }] },
    })

    expect(top.lines[0]?.x).toBe(175000)
    expect(top.lines[0]?.y).toBe(130000)
    expect(top.lines[0]?.height).toBe(274320)
    expect(middle.lines[0]?.y).toBeGreaterThan(0)
    expect(middle.contentBounds.h).toBe(middle.lines[0]?.height)
  })

  it('returns structured-clone-safe line boxes and reports vertical overflow', () => {
    const layout = layoutText({
      bounds: { x: 100000, y: 200000, w: 1000000, h: 100000 },
      body: { paragraphs: [{ runs: [{ text: 'A' }] }, { runs: [{ text: 'B' }] }] },
    })

    expect(structuredClone(layout)).toEqual(layout)
    expect(layout.overflow).toBe(true)
    expect(layout.contentBounds.h).toBeGreaterThan(100000)
  })

  it('keeps bounds and reports overflow with none Autofit', () => {
    const layout = layoutText({
      bounds: { x: 10, y: 20, w: 500000, h: 300000 },
      body: { bodyPr: { autofit: { type: 'none' } }, paragraphs: [{ runs: [{ text: 'A' }] }, { runs: [{ text: 'B' }] }] },
    })

    expect(layout.bounds).toEqual({ x: 10, y: 20, w: 500000, h: 300000 })
    expect(layout.fontScale).toBe(100000)
    expect(layout.overflow).toBe(true)
  })

  it('shrinks font scale to the largest fitting value without changing bounds', () => {
    const layout = layoutText({
      bounds: { x: 10, y: 20, w: 500000, h: 342900 },
      body: { bodyPr: { autofit: { type: 'shrink', minFontScale: 50000 } }, paragraphs: [{ runs: [{ text: 'A' }] }, { runs: [{ text: 'B' }] }] },
    })

    expect(layout.bounds).toEqual({ x: 10, y: 20, w: 500000, h: 342900 })
    expect(layout.fontScale).toBe(75000)
    expect(layout.overflow).toBe(false)
    expect(layout.lines[0]?.runs[0]?.marks).toBeUndefined()
  })

  it('resizes height while preserving width and honors maxHeight', () => {
    const resized = layoutText({
      bounds: { x: 10, y: 20, w: 500000, h: 300000 },
      body: { bodyPr: { autofit: { type: 'resize' } }, paragraphs: [{ runs: [{ text: 'A' }] }, { runs: [{ text: 'B' }] }] },
    })
    const capped = layoutText({
      bounds: { x: 10, y: 20, w: 500000, h: 300000 },
      body: { bodyPr: { autofit: { type: 'resize', maxHeight: 400000 } }, paragraphs: [{ runs: [{ text: 'A' }] }, { runs: [{ text: 'B' }] }, { runs: [{ text: 'C' }] }] },
    })

    expect(resized.bounds).toEqual({ x: 10, y: 20, w: 500000, h: 457200 })
    expect(resized.overflow).toBe(false)
    expect(capped.bounds.h).toBe(400000)
    expect(capped.overflow).toBe(true)
  })
})

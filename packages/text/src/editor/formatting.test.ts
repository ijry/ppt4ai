import type { TextBody } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import {
  createTextEditorState,
  getTextEditorSnapshot,
  replaceText,
  getTextFormattingState,
  setTextEditorSelection,
  setTextAlignment,
  setTextMarks,
  toggleTextMark,
} from '../index'

describe('text formatting transactions', () => {
  it('formats only the selected UTF-16 range and preserves reverse selection', () => {
    const body: TextBody = {
      paragraphs: [{ runs: [{ text: 'Hello', marks: { fontFamily: 'Arial', italic: true } }] }],
    }
    const state = setTextEditorSelection(createTextEditorState(body), { anchor: 4, head: 2 })

    const formatted = setTextMarks(state, { bold: true })

    expect(getTextEditorSnapshot(formatted).body).toEqual({
      paragraphs: [{ runs: [
        { text: 'H', marks: { fontFamily: 'Arial', italic: true } },
        { text: 'el', marks: { fontFamily: 'Arial', italic: true, bold: true } },
        { text: 'lo', marks: { fontFamily: 'Arial', italic: true } },
      ] }],
    })
    expect(getTextEditorSnapshot(formatted).selection).toEqual({ anchor: 4, head: 2 })
  })

  it('removes a patched mark and coalesces adjacent equal runs', () => {
    const state = setTextEditorSelection(createTextEditorState({
      paragraphs: [{ runs: [
        { text: 'A', marks: { bold: true, fontFamily: 'Arial' } },
        { text: 'B', marks: { bold: true, fontFamily: 'Arial' } },
      ] }],
    }), { anchor: 1, head: 3 })

    const formatted = setTextMarks(state, { bold: undefined, fontFamily: undefined })

    expect(getTextEditorSnapshot(formatted).body).toEqual({ paragraphs: [{ runs: [{ text: 'AB' }] }] })
  })

  it('stores collapsed formatting for subsequent input without rewriting existing text', () => {
    const state = setTextEditorSelection(createTextEditorState({
      paragraphs: [{ runs: [{ text: 'AB', marks: { italic: true } }] }],
    }), { anchor: 2, head: 2 })

    const formatted = setTextMarks(state, { bold: true, fontSize: 18 })
    const inserted = replaceText(formatted, 'X')

    expect(getTextEditorSnapshot(formatted).body).toEqual({
      paragraphs: [{ runs: [{ text: 'AB', marks: { italic: true } }] }],
    })
    expect(getTextEditorSnapshot(inserted).body).toEqual({
      paragraphs: [{ runs: [
        { text: 'A', marks: { italic: true } },
        { text: 'X', marks: { italic: true, bold: true, fontSize: 18 } },
        { text: 'B', marks: { italic: true } },
      ] }],
    })
  })

  it('toggles uniform and mixed boolean marks', () => {
    const uniform = setTextEditorSelection(createTextEditorState({
      paragraphs: [{ runs: [{ text: 'AB', marks: { bold: true } }] }],
    }), { anchor: 1, head: 3 })
    expect(getTextEditorSnapshot(toggleTextMark(uniform, 'bold')).body).toEqual({
      paragraphs: [{ runs: [{ text: 'AB', marks: { bold: false } }] }],
    })

    const mixed = setTextEditorSelection(createTextEditorState({
      paragraphs: [{ runs: [
        { text: 'A', marks: { bold: true } },
        { text: 'B' },
      ] }],
    }), { anchor: 1, head: 3 })
    expect(getTextEditorSnapshot(toggleTextMark(mixed, 'bold')).body).toEqual({
      paragraphs: [{ runs: [{ text: 'AB', marks: { bold: true } }] }],
    })
  })

  it('rejects invalid formatting before changing state', () => {
    const state = createTextEditorState({ paragraphs: [{ runs: [{ text: 'A' }] }] })
    const before = getTextEditorSnapshot(state)

    expect(() => setTextMarks(state, { fontFamily: '   ' })).toThrow()
    expect(() => setTextMarks(state, { fontSize: 0 })).toThrow()
    expect(() => setTextMarks(state, { fontSize: Number.NaN })).toThrow()
    // `double` is a legal token shape now; only a word that is not a token at all is refused.
    expect(() => setTextMarks(state, { underline: 'not a token!' })).toThrow()
    expect(() => setTextMarks(state, { color: { color: { type: 'srgb', v: '' } } })).toThrow()
    expect(getTextEditorSnapshot(state)).toEqual(before)
  })

  it('accepts structured color transforms and rejects invalid transform values', () => {
    const state = setTextEditorSelection(
      createTextEditorState({ paragraphs: [{ runs: [{ text: 'A' }] }] }),
      { anchor: 1, head: 2 },
    )
    const formatted = setTextMarks(state, {
      color: {
        color: {
          type: 'srgb',
          v: '336699',
          transforms: [{ type: 'tint', value: 50000 }],
        },
      },
    })

    expect(getTextEditorSnapshot(formatted).body.paragraphs[0]?.runs[0]?.marks?.color).toEqual({
      color: {
        type: 'srgb',
        v: '336699',
        transforms: [{ type: 'tint', value: 50000 }],
      },
    })
    expect(() => setTextMarks(state, {
      color: {
        color: {
          type: 'srgb',
          v: '336699',
          transforms: [{ type: 'tint', value: -1 }],
        },
      },
    })).toThrow()
  })

  it('reports uniform, mixed, and collapsed formatting state', () => {
    const uniform = setTextEditorSelection(createTextEditorState({
      paragraphs: [{ runs: [{ text: 'AB', marks: { bold: true, italic: true, underline: 'sng', fontFamily: 'Arial', fontSize: 18, color: { color: { type: 'srgb', v: 'ff0000' } } } }] }],
    }), { anchor: 1, head: 3 })
    expect(getTextFormattingState(uniform)).toEqual({
      bold: true,
      italic: true,
      underline: true,
      fontFamily: 'Arial',
      fontSize: 18,
      color: { color: { type: 'srgb', v: 'ff0000' } },
    })

    const mixed = setTextEditorSelection(createTextEditorState({
      paragraphs: [{ runs: [
        { text: 'A', marks: { bold: true, fontFamily: 'Arial' } },
        { text: 'B', marks: { italic: true, fontFamily: 'Calibri' } },
      ] }],
    }), { anchor: 1, head: 3 })
    expect(getTextFormattingState(mixed)).toEqual({
      bold: 'mixed',
      italic: 'mixed',
      underline: false,
      fontFamily: undefined,
      fontSize: undefined,
      color: undefined,
    })

    const collapsed = setTextEditorSelection(createTextEditorState({
      paragraphs: [{ runs: [{ text: 'AB', marks: { italic: true } }] }],
    }), { anchor: 2, head: 2 })
    expect(getTextFormattingState(collapsed)).toEqual({ bold: false, italic: true, underline: false })
    const stored = setTextMarks(collapsed, { bold: true })
    expect(getTextFormattingState(stored)).toEqual({ bold: true, italic: true, underline: false })
    const clone = getTextFormattingState(uniform)
    clone.color!.color.v = '00ff00'
    expect(getTextFormattingState(uniform).color).toEqual({ color: { type: 'srgb', v: 'ff0000' } })
  })

  it('updates every selected paragraph alignment while preserving attributes and direction', () => {
    const body: TextBody = {
      paragraphs: [
        { attrs: { align: 'left', level: 1 }, runs: [{ text: 'AB' }] },
        { attrs: { align: 'center', indent: 20, lineSpacing: 1.5 }, runs: [{ text: 'CD' }] },
        { attrs: { align: 'right', marginLeft: 30 }, runs: [{ text: 'EF' }] },
      ],
    }
    const selected = setTextEditorSelection(createTextEditorState(body), { anchor: 10, head: 2 })

    const aligned = setTextAlignment(selected, 'center')

    expect(getTextEditorSnapshot(aligned).body).toEqual({
      paragraphs: [
        { attrs: { align: 'center', level: 1 }, runs: [{ text: 'AB' }] },
        { attrs: { align: 'center', indent: 20, lineSpacing: 1.5 }, runs: [{ text: 'CD' }] },
        { attrs: { align: 'center', marginLeft: 30 }, runs: [{ text: 'EF' }] },
      ],
    })
    expect(getTextEditorSnapshot(aligned).selection).toEqual({ anchor: 10, head: 2 })
  })

  it('aligns only the collapsed cursor paragraph and rejects invalid alignment', () => {
    const state = setTextEditorSelection(createTextEditorState({
      paragraphs: [
        { attrs: { align: 'left' }, runs: [{ text: 'A' }] },
        { attrs: { align: 'right', level: 2 }, runs: [{ text: 'B' }] },
      ],
    }), { anchor: 4, head: 4 })
    const aligned = setTextAlignment(state, 'center')
    expect(getTextEditorSnapshot(aligned).body).toEqual({
      paragraphs: [
        { attrs: { align: 'left' }, runs: [{ text: 'A' }] },
        { attrs: { align: 'center', level: 2 }, runs: [{ text: 'B' }] },
      ],
    })
    expect(() => setTextAlignment(state, 'justify' as 'left')).toThrow()
    expect(getTextEditorSnapshot(state).body.paragraphs[1]?.attrs?.align).toBe('right')
  })
})

describe('text highlight formatting', () => {
  it('sets a run highlight colour over the selection and reads it back', () => {
    const state = setTextEditorSelection(createTextEditorState({ paragraphs: [{ runs: [{ text: 'AB' }] }] }), { anchor: 1, head: 3 })
    const formatted = setTextMarks(state, { highlight: { type: 'srgb', v: 'FFFF00' } })

    expect(getTextEditorSnapshot(formatted).body.paragraphs[0]?.runs[0]?.marks?.highlight).toEqual({ type: 'srgb', v: 'FFFF00' })
    expect(getTextFormattingState(formatted).highlight).toEqual({ type: 'srgb', v: 'FFFF00' })
  })

  it('clears the highlight when set to undefined', () => {
    const withHighlight = setTextEditorSelection(createTextEditorState({ paragraphs: [{ runs: [{ text: 'AB', marks: { highlight: { type: 'srgb', v: 'FFFF00' } } }] }] }), { anchor: 1, head: 3 })
    const cleared = setTextMarks(withHighlight, { highlight: undefined })

    expect(getTextEditorSnapshot(cleared).body.paragraphs[0]?.runs[0]?.marks?.highlight).toBeUndefined()
    expect(getTextFormattingState(cleared).highlight).toBeUndefined()
  })

  it('rejects an invalid highlight colour', () => {
    const state = setTextEditorSelection(createTextEditorState({ paragraphs: [{ runs: [{ text: 'A' }] }] }), { anchor: 1, head: 2 })
    expect(() => setTextMarks(state, { highlight: { type: 'srgb', v: '' } as never })).toThrow()
  })

  it('reports a mixed highlight as undefined across differing runs', () => {
    const mixed = setTextEditorSelection(createTextEditorState({
      paragraphs: [{ runs: [
        { text: 'A', marks: { highlight: { type: 'srgb', v: 'FFFF00' } } },
        { text: 'B' },
      ] }],
    }), { anchor: 1, head: 3 })
    expect(getTextFormattingState(mixed).highlight).toBeUndefined()
  })
})

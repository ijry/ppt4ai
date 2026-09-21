import { describe, expect, it } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import {
  createTextEditorState,
  getTextEditorSnapshot,
  getTextFormattingState,
  setTextMarks,
} from '../index'

/**
 * Every case selects a range first. With an empty selection `setTextMarks` only sets stored marks, which
 * reach no run until something is typed, and `getTextFormattingState` reports the marks at the cursor
 * rather than across the text — neither would exercise what the toolbar does.
 */
function selectingAll(body: Parameters<typeof createTextEditorState>[0]) {
  const state = createTextEditorState(body)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)))
}

describe('east asian typeface mark', () => {
  it('is accepted by setTextMarks', () => {
    const next = setTextMarks(selectingAll({ paragraphs: [{ runs: [{ text: 'Hi 你好' }] }] }), { fontFamilyEa: '宋体' })
    const body = getTextEditorSnapshot(next)

    expect(JSON.stringify(body)).toContain('宋体')
  })

  it('sits alongside the latin typeface rather than replacing it', () => {
    const next = setTextMarks(selectingAll({ paragraphs: [{ runs: [{ text: 'Hi 你好' }] }] }), { fontFamily: 'Calibri', fontFamilyEa: '宋体' })
    const serialized = JSON.stringify(getTextEditorSnapshot(next))

    expect(serialized).toContain('Calibri')
    expect(serialized).toContain('宋体')
  })

  it('reports the value through the formatting state', () => {
    const next = setTextMarks(selectingAll({ paragraphs: [{ runs: [{ text: 'Hi 你好' }] }] }), { fontFamilyEa: '宋体' })

    expect(getTextFormattingState(next).fontFamilyEa).toBe('宋体')
  })

  it('leaves the state value absent when the selection disagrees', () => {
    const body = {
      paragraphs: [{
        runs: [
          { text: '一', marks: { fontFamilyEa: '宋体' } },
          { text: '二', marks: { fontFamilyEa: '黑体' } },
        ],
      }],
    }
    expect(getTextFormattingState(selectingAll(body)).fontFamilyEa).toBeUndefined()
  })

  it('rejects an empty or non-string value the way the latin slot does', () => {
    const state = selectingAll({ paragraphs: [{ runs: [{ text: 'Hi' }] }] })

    expect(() => setTextMarks(state, { fontFamilyEa: '' })).toThrow(/fontFamilyEa must be non-empty/)
    expect(() => setTextMarks(state, { fontFamilyEa: '   ' })).toThrow(/fontFamilyEa must be non-empty/)
    expect(() => setTextMarks(state, { fontFamilyEa: 12 as never })).toThrow(/fontFamilyEa must be non-empty/)
  })

  /** `fontFamilyCs` round-trips but is never chosen by paint, so it deliberately has no editing path. */
  it('still refuses the complex script slot', () => {
    const state = selectingAll({ paragraphs: [{ runs: [{ text: 'Hi' }] }] })

    expect(() => setTextMarks(state, { fontFamilyCs: 'Arial' } as never)).toThrow(/unsupported text mark/)
  })
})

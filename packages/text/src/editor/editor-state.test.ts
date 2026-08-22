import type { TextBody } from '@ppt4ai/model'
import { TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import {
  applyImeEvent,
  createTextEditorState,
  deleteBackward,
  getTextEditorSnapshot,
  insertParagraph,
  replaceText,
} from '../index'

const body: TextBody = { paragraphs: [{ runs: [{ text: 'AB', marks: { bold: true } }] }] }

describe('ProseMirror text editor state', () => {
  it('replaces the selected text without mutating the input state', () => {
    const state = createTextEditorState(body)
    const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 3)))
    const replaced = replaceText(selected, '新文本')

    expect(getTextEditorSnapshot(replaced).body).toEqual({
      paragraphs: [{ runs: [{ text: '新文本', marks: { bold: true } }] }],
    })
    expect(getTextEditorSnapshot(selected).body).toEqual(body)
    expect(structuredClone(getTextEditorSnapshot(replaced))).toEqual(getTextEditorSnapshot(replaced))
  })

  it('splits a paragraph on Enter without inserting a newline text node', () => {
    const state = createTextEditorState(body)
    const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)))
    const split = insertParagraph(selected)
    const snapshot = getTextEditorSnapshot(split)

    expect(snapshot.body).toEqual({
      paragraphs: [
        { runs: [{ text: 'A', marks: { bold: true } }] },
        { runs: [{ text: 'B', marks: { bold: true } }] },
      ],
    })
    expect(split.doc.childCount).toBe(2)
    expect(split.doc.textContent).toBe('AB')
    expect(split.doc.textContent).not.toContain('\n')
  })

  it('deletes a selection or one character backward', () => {
    const state = createTextEditorState(body)
    const atEnd = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)))
    const deletedCharacter = deleteBackward(atEnd)
    expect(getTextEditorSnapshot(deletedCharacter).body.paragraphs[0]?.runs[0]?.text).toBe('A')

    const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 3)))
    const deletedSelection = deleteBackward(selected)
    expect(getTextEditorSnapshot(deletedSelection).body).toEqual({ paragraphs: [{ runs: [] }] })
  })

  it('keeps provisional composition out of the body and commits once on end', () => {
    let state = createTextEditorState({ paragraphs: [{ runs: [] }] })
    state = applyImeEvent(state, { type: 'composition-start' })
    state = applyImeEvent(state, { type: 'composition-update', text: 'zhong' })

    expect(getTextEditorSnapshot(state)).toMatchObject({
      body: { paragraphs: [{ runs: [] }] },
      composing: true,
      compositionText: 'zhong',
    })

    state = applyImeEvent(state, { type: 'composition-end', text: '中' })
    expect(getTextEditorSnapshot(state)).toMatchObject({
      body: { paragraphs: [{ runs: [{ text: '中' }] }] },
      composing: false,
      compositionText: '',
    })

    state = applyImeEvent(state, { type: 'text-input', text: '中' })
    expect(getTextEditorSnapshot(state).body.paragraphs[0]?.runs[0]?.text).toBe('中')
    state = applyImeEvent(state, { type: 'text-input', text: 'A' })
    expect(getTextEditorSnapshot(state).body.paragraphs[0]?.runs[0]?.text).toBe('中A')
  })

  it('handles out-of-order composition end and maps bridge editing events', () => {
    let state = createTextEditorState({ paragraphs: [{ runs: [{ text: 'AB' }] }] })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)))
    state = applyImeEvent(state, { type: 'composition-end', text: '中' })
    state = applyImeEvent(state, { type: 'insert-line-break' })
    state = applyImeEvent(state, { type: 'text-input', text: 'C' })
    state = applyImeEvent(state, { type: 'delete-backward' })

    expect(getTextEditorSnapshot(state).body).toEqual({
      paragraphs: [{ runs: [{ text: 'A中' }] }, { runs: [{ text: 'B' }] }],
    })
    expect(getTextEditorSnapshot(state).selection).toEqual({ anchor: 5, head: 5 })
    expect(state.selection.$from.parentOffset).toBe(0)
    expect(state.selection.$from.index(0)).toBe(1)
  })
})

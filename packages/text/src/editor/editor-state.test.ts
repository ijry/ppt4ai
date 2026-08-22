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
  setTextBullet,
  clearTextBullet,
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

  it('sets and clears bullets on every selected paragraph without changing text', () => {
    const state = createTextEditorState({ paragraphs: [{ runs: [{ text: 'AB' }] }, { runs: [{ text: 'CD' }], attrs: { level: 1 } }] })
    const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)))
    const listed = setTextBullet(selected, { type: 'autoNum', scheme: 'arabic', startAt: 3 })

    expect(getTextEditorSnapshot(listed).body).toEqual({
      paragraphs: [
        { runs: [{ text: 'AB' }], attrs: { bullet: { type: 'autoNum', scheme: 'arabic', startAt: 3 } } },
        { runs: [{ text: 'CD' }], attrs: { level: 1, bullet: { type: 'autoNum', scheme: 'arabic', startAt: 3 } } },
      ],
    })
    expect(listed.doc.textContent).toBe(selected.doc.textContent)

    const cleared = clearTextBullet(listed)
    expect(getTextEditorSnapshot(cleared).body).toEqual({ paragraphs: [{ runs: [{ text: 'AB' }] }, { runs: [{ text: 'CD' }], attrs: { level: 1 } }] })
  })

  it('targets a collapsed cursor paragraph, preserves reverse selection, and rejects invalid bullets', () => {
    let state = createTextEditorState({ paragraphs: [{ runs: [{ text: 'AB' }] }, { runs: [{ text: 'CD' }] }] })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 5)))
    const listed = setTextBullet(state, { type: 'char', char: '•' })
    expect(getTextEditorSnapshot(listed).body.paragraphs.map((paragraph) => paragraph.attrs?.bullet)).toEqual([
      undefined,
      { type: 'char', char: '•' },
    ])
    expect(listed.selection.anchor).toBe(state.selection.anchor)
    expect(listed.selection.head).toBe(state.selection.head)

    const reverse = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 6, 2)))
    const reverseListed = setTextBullet(reverse, { type: 'char', char: '•' })
    expect(reverseListed.selection.anchor).toBe(reverse.selection.anchor)
    expect(reverseListed.selection.head).toBe(reverse.selection.head)

    expect(() => setTextBullet(state, { type: 'char', char: 'xx' })).toThrow()
    expect(getTextEditorSnapshot(state).body.paragraphs[1]?.attrs).toBeUndefined()
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

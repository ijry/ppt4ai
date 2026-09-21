import { describe, expect, it } from 'vitest'
import { initialImeSessionState, reduceImeSession } from './ime-session'

describe('reduceImeSession', () => {
  it('inserts a line break at the caret', () => {
    const state = { committedText: 'AB', compositionText: '', isComposing: false, caretOffset: 1 }

    expect(reduceImeSession(state, { type: 'insert-line-break' })).toEqual({
      committedText: 'A\nB',
      compositionText: '',
      isComposing: false,
      caretOffset: 2,
    })
  })
  it('shows composition without changing committed text', () => {
    const started = reduceImeSession(initialImeSessionState, { type: 'composition-start' })
    const updated = reduceImeSession(started, { type: 'composition-update', text: 'zhong' })
    expect(updated).toEqual({ committedText: '', compositionText: 'zhong', isComposing: true, caretOffset: 0 })
  })

  it('commits inserted text once after composition ends', () => {
    const composing = { committedText: '', compositionText: 'zhong', isComposing: true, caretOffset: 0 }
    const ended = reduceImeSession(composing, { type: 'composition-end', text: '' })
    const inserted = reduceImeSession(ended, { type: 'text-input', text: '中' })
    expect(inserted).toEqual({ committedText: '中', compositionText: '', isComposing: false, caretOffset: 1 })
  })

  it('deletes one Unicode code point', () => {
    const state = { committedText: 'A中', compositionText: '', isComposing: false, caretOffset: 2 }
    expect(reduceImeSession(state, { type: 'delete-backward' }).committedText).toBe('A')
  })

  it('keeps independent composition cycles in committed order', () => {
    let state = initialImeSessionState
    for (const [romanized, committed] of [['zhong', '中'], ['wen', '文']] as const) {
      state = reduceImeSession(state, { type: 'composition-start' })
      state = reduceImeSession(state, { type: 'composition-update', text: romanized })
      state = reduceImeSession(state, { type: 'composition-end', text: '' })
      state = reduceImeSession(state, { type: 'text-input', text: committed })
    }
    expect(state).toEqual({ committedText: '中文', compositionText: '', isComposing: false, caretOffset: 2 })
  })
})

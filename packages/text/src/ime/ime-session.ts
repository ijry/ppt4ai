import type { ImeBridgeEvent, ImeSessionState } from './types'

export const initialImeSessionState: ImeSessionState = {
  committedText: '',
  compositionText: '',
  isComposing: false,
  caretOffset: 0,
}

export function reduceImeSession(
  state: ImeSessionState,
  event: ImeBridgeEvent,
): ImeSessionState {
  switch (event.type) {
    case 'composition-start':
      return { ...state, compositionText: '', isComposing: true }
    case 'composition-update':
      return { ...state, compositionText: event.text, isComposing: true }
    case 'composition-end':
      return { ...state, compositionText: '', isComposing: false }
    case 'text-input':
      return insertText(state, event.text)
    case 'insert-line-break':
      return insertText(state, '\n')
    case 'delete-backward':
      if (state.caretOffset === 0) return state
      return {
        ...state,
        committedText: removeAt(state.committedText, state.caretOffset - 1),
        caretOffset: state.caretOffset - 1,
      }
  }
}

function insertText(state: ImeSessionState, text: string): ImeSessionState {
  const offset = clampOffset(state.committedText, state.caretOffset)
  return {
    ...state,
    committedText: insertAt(state.committedText, offset, text),
    caretOffset: offset + [...text].length,
  }
}

function insertAt(text: string, offset: number, insertion: string): string {
  const characters = [...text]
  characters.splice(offset, 0, ...insertion)
  return characters.join('')
}

function removeAt(text: string, offset: number): string {
  const characters = [...text]
  characters.splice(offset, 1)
  return characters.join('')
}

function clampOffset(text: string, offset: number): number {
  return Math.min(Math.max(0, offset), [...text].length)
}

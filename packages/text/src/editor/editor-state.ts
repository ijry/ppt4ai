import type { TextBody } from '@ppt4ai/model'
import { deleteSelection, joinBackward, splitBlock } from 'prosemirror-commands'
import { EditorState, Plugin, PluginKey, TextSelection, type Transaction } from 'prosemirror-state'
import type { ImeBridgeEvent } from '../ime/types'
import { proseMirrorToTextBody, textBodyToProseMirror } from './model'
import { textEditorSchema } from './schema'

interface CompositionState {
  readonly composing: boolean
  readonly compositionText: string
  readonly suppressedTextInput?: string
}

const initialCompositionState: CompositionState = {
  composing: false,
  compositionText: '',
}

const compositionPluginKey = new PluginKey<CompositionState>('ppt4ai-text-composition')

type CompositionMeta =
  | { readonly type: 'composition-start' }
  | { readonly type: 'composition-update'; readonly text: string }
  | { readonly type: 'composition-end'; readonly text: string }
  | { readonly type: 'clear-suppressed-text-input' }

const compositionPlugin = new Plugin<CompositionState>({
  key: compositionPluginKey,
  state: {
    init: () => initialCompositionState,
    apply(transaction, value) {
      const meta = transaction.getMeta(compositionPluginKey) as CompositionMeta | undefined
      if (!meta) return value
      switch (meta.type) {
        case 'composition-start':
          return { composing: true, compositionText: '' }
        case 'composition-update':
          return { composing: true, compositionText: meta.text }
        case 'composition-end':
          return meta.text ? { composing: false, compositionText: '', suppressedTextInput: meta.text } : { composing: false, compositionText: '' }
        case 'clear-suppressed-text-input':
          return { composing: value.composing, compositionText: value.compositionText }
      }
    },
  },
})

export interface TextEditorSelection {
  readonly anchor: number
  readonly head: number
}

export interface TextEditorSnapshot {
  readonly body: TextBody
  readonly selection: TextEditorSelection
  readonly composing: boolean
  readonly compositionText: string
}

export function createTextEditorState(body: TextBody): EditorState {
  return requireEditorState(textBodyToProseMirror(body))
}

export function replaceText(state: EditorState, text: string): EditorState {
  return state.apply(state.tr.insertText(text))
}

export function insertParagraph(state: EditorState): EditorState {
  return runCommand(state, splitBlock)
}

export function deleteBackward(state: EditorState): EditorState {
  if (!state.selection.empty) return runCommand(state, deleteSelection)
  if (state.selection instanceof TextSelection && state.selection.$cursor && state.selection.$cursor.parentOffset > 0) {
    return state.apply(state.tr.delete(state.selection.from - 1, state.selection.from))
  }
  return runCommand(state, joinBackward)
}

export function applyImeEvent(state: EditorState, event: ImeBridgeEvent): EditorState {
  const composition = compositionPluginKey.getState(state) ?? initialCompositionState
  switch (event.type) {
    case 'composition-start':
      return applyMeta(state, { type: 'composition-start' })
    case 'composition-update':
      return applyMeta(state, { type: 'composition-update', text: event.text })
    case 'composition-end': {
      const committed = event.text ? replaceText(state, event.text) : state
      return applyMeta(committed, { type: 'composition-end', text: event.text })
    }
    case 'text-input':
      if (composition.suppressedTextInput === event.text) return applyMeta(state, { type: 'clear-suppressed-text-input' })
      return applyMeta(replaceText(state, event.text), { type: 'clear-suppressed-text-input' })
    case 'insert-line-break':
      return insertParagraph(state)
    case 'delete-backward':
      return deleteBackward(state)
  }
}

export function getTextEditorSnapshot(state: EditorState): TextEditorSnapshot {
  const composition = compositionPluginKey.getState(state) ?? initialCompositionState
  return {
    body: proseMirrorToTextBody(state.doc),
    selection: { anchor: state.selection.anchor, head: state.selection.head },
    composing: composition.composing,
    compositionText: composition.compositionText,
  }
}

function requireEditorState(document: ReturnType<typeof textBodyToProseMirror>): EditorState {
  return EditorState.create({
    schema: textEditorSchema,
    doc: document,
    plugins: [compositionPlugin],
  })
}

function applyMeta(state: EditorState, meta: CompositionMeta): EditorState {
  return state.apply(state.tr.setMeta(compositionPluginKey, meta))
}

function runCommand(state: EditorState, command: (state: EditorState, dispatch?: (transaction: Transaction) => void) => boolean): EditorState {
  let next = state
  command(state, (transaction) => {
    next = state.apply(transaction)
  })
  return next
}

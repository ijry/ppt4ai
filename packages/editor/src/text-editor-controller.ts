import type { TextBody } from '@ppt4ai/model'
import {
  applyImeEvent,
  createImeInputBridge,
  createTextEditorState,
  getTextFormattingState,
  getTextEditorSnapshot,
  setTextAlignment,
  setTextMarks,
  setTextEditorSelection,
  toggleTextMark,
  type ImeBridgeEvent,
  type ImeInputBridge,
  type ImeInputBridgeOptions,
  type ScreenRect,
  type TextEditorSelection,
  type TextEditorSnapshot,
  type TextFormattingState,
  type TextMarkName,
  type TextMarksPatch,
} from '@ppt4ai/text'

export interface TextEditorControllerOptions {
  readonly host: HTMLElement
  readonly body: TextBody
  readonly bridgeFactory?: (options: ImeInputBridgeOptions) => ImeInputBridge
}

export interface TextEditorController {
  getSnapshot(): TextEditorSnapshot
  getFormattingState(): TextFormattingState
  setMarks(patch: TextMarksPatch): void
  toggleMark(name: TextMarkName): void
  setAlignment(align: 'left' | 'center' | 'right'): void
  setSelection(selection: TextEditorSelection): void
  subscribe(listener: (snapshot: TextEditorSnapshot) => void): () => void
  syncCaret(rect: ScreenRect): void
  focus(): void
  dispatch(event: ImeBridgeEvent): void
  destroy(): void
}

export function createTextEditorController(options: TextEditorControllerOptions): TextEditorController {
  let state = createTextEditorState(options.body)
  let destroyed = false
  let caretRect: ScreenRect | undefined
  const listeners = new Set<(snapshot: TextEditorSnapshot) => void>()

  const publish = (): void => {
    if (destroyed) return
    const snapshot = getTextEditorSnapshot(state)
    for (const listener of listeners) listener(structuredClone(snapshot))
  }

  const applyFormatting = (command: (current: typeof state) => typeof state): void => {
    if (destroyed) return
    const nextState = command(state)
    if (nextState === state) return
    state = nextState
    publish()
  }

  const dispatch = (event: ImeBridgeEvent): void => {
    if (destroyed) return
    state = applyImeEvent(state, event)
    publish()
  }
  const bridge = (options.bridgeFactory ?? createImeInputBridge)({
    host: options.host,
    onEvent: dispatch,
  })

  return {
    getSnapshot: () => getTextEditorSnapshot(state),
    getFormattingState: () => structuredClone(getTextFormattingState(state)),
    setMarks(patch): void {
      applyFormatting((current) => setTextMarks(current, patch))
    },
    toggleMark(name): void {
      applyFormatting((current) => toggleTextMark(current, name))
    },
    setAlignment(align): void {
      applyFormatting((current) => setTextAlignment(current, align))
    },
    setSelection(selection): void {
      if (destroyed) return
      const nextState = setTextEditorSelection(state, selection)
      if (nextState === state) return
      state = nextState
      publish()
    },
    subscribe(listener): () => void {
      if (destroyed) return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    syncCaret(rect): void {
      if (destroyed) return
      caretRect = { ...rect }
      bridge.setCaretRect(caretRect)
    },
    focus(): void {
      if (destroyed) return
      bridge.focus()
      if (caretRect) bridge.setCaretRect({ ...caretRect })
    },
    dispatch,
    destroy(): void {
      if (destroyed) return
      destroyed = true
      listeners.clear()
      bridge.destroy()
    },
  }
}

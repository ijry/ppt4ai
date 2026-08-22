import type { TextBody } from '@ppt4ai/model'
import {
  applyImeEvent,
  createImeInputBridge,
  createTextEditorState,
  getTextEditorSnapshot,
  setTextEditorSelection,
  type ImeBridgeEvent,
  type ImeInputBridge,
  type ImeInputBridgeOptions,
  type ScreenRect,
  type TextEditorSelection,
  type TextEditorSnapshot,
} from '@ppt4ai/text'

export interface TextEditorControllerOptions {
  readonly host: HTMLElement
  readonly body: TextBody
  readonly bridgeFactory?: (options: ImeInputBridgeOptions) => ImeInputBridge
}

export interface TextEditorController {
  getSnapshot(): TextEditorSnapshot
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

import type { TextBody } from '@ppt4ai/model'
import {
  applyImeEvent,
  createImeInputBridge,
  createTextEditorState,
  getTextEditorSnapshot,
  type ImeBridgeEvent,
  type ImeInputBridge,
  type ImeInputBridgeOptions,
  type TextEditorSnapshot,
} from '@ppt4ai/text'

export interface TextEditorControllerOptions {
  readonly host: HTMLElement
  readonly body: TextBody
  readonly bridgeFactory?: (options: ImeInputBridgeOptions) => ImeInputBridge
}

export interface TextEditorController {
  getSnapshot(): TextEditorSnapshot
  focus(): void
  dispatch(event: ImeBridgeEvent): void
  destroy(): void
}

export function createTextEditorController(options: TextEditorControllerOptions): TextEditorController {
  let state = createTextEditorState(options.body)
  let destroyed = false

  const dispatch = (event: ImeBridgeEvent): void => {
    if (destroyed) return
    state = applyImeEvent(state, event)
  }
  const bridge = (options.bridgeFactory ?? createImeInputBridge)({
    host: options.host,
    onEvent: dispatch,
  })

  return {
    getSnapshot: () => getTextEditorSnapshot(state),
    focus(): void {
      if (!destroyed) bridge.focus()
    },
    dispatch,
    destroy(): void {
      if (destroyed) return
      destroyed = true
      bridge.destroy()
    },
  }
}

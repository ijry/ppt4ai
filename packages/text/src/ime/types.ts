export interface ScreenPoint {
  readonly x: number
  readonly y: number
}

export interface ScreenRect extends ScreenPoint {
  readonly width: number
  readonly height: number
}

export type ImeBridgeEvent =
  | { readonly type: 'composition-start' }
  | { readonly type: 'composition-update'; readonly text: string }
  | { readonly type: 'composition-end'; readonly text: string }
  | { readonly type: 'text-input'; readonly text: string }
  | { readonly type: 'insert-line-break' }
  | { readonly type: 'delete-backward' }

export interface ImeSessionState {
  readonly committedText: string
  readonly compositionText: string
  readonly isComposing: boolean
  readonly caretOffset: number
}

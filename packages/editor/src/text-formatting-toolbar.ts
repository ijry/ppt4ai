import type { TextFormattingState, TextMarkName, TextMarksPatch } from '@ppt4ai/text'

export interface TextFormattingToolbarProps {
  readonly active: boolean
  readonly state: TextFormattingState
  readonly fontFamilies: readonly string[]
  readonly fontSizes: readonly number[]
}

export type TextFormattingToolbarEmit = {
  (event: 'set-marks', patch: TextMarksPatch): void
  (event: 'toggle-mark', name: TextMarkName): void
  (event: 'set-alignment', align: 'left' | 'center' | 'right'): void
}

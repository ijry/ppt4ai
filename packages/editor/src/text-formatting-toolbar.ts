import type { TextFormattingState, TextMarkName, TextMarksPatch } from '@ppt4ai/text'

export interface TextFormattingToolbarProps {
  readonly active: boolean
  readonly state: TextFormattingState
  readonly fontFamilies: readonly string[]
  /**
   * Typefaces offered for the east asian slot (`a:ea`). A CJK list is usually not the latin one, so the
   * host can give both; with only one given the same list serves both slots rather than the control
   * disappearing, which is what the default configuration would otherwise do.
   */
  readonly eaFontFamilies?: readonly string[]
  readonly fontSizes: readonly number[]
}

export type TextFormattingToolbarEmit = {
  (event: 'set-marks', patch: TextMarksPatch): void
  (event: 'toggle-mark', name: TextMarkName): void
  (event: 'set-alignment', align: 'left' | 'center' | 'right'): void
}

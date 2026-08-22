import type { Fill, TableBorder } from '@ppt4ai/model'
import type { TableBorderPatch, TableBorderSide } from './table-editor-controller'

export interface TableFormattingToolbarProps {
  readonly active: boolean
  readonly fillColor?: string
  readonly borderColor?: string
  readonly borderWidth: number
  readonly borderStyle: 'solid' | 'dash' | 'dot'
  readonly borderSides: readonly TableBorderSide[]
}

export type TableFormattingToolbarEmit = {
  (event: 'set-fill', fill: Fill | null): void
  (event: 'set-borders', borders: TableBorderPatch): void
}

export type { TableBorderSide, TableBorderPatch, TableBorder }

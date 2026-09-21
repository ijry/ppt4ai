import type { SceneTableLayoutCell } from '@ppt4ai/render'
import type { ImeInputBridge, ImeInputBridgeOptions } from '@ppt4ai/text'
import type { TextViewportTransform } from './text-editor-interaction'

export interface TableCellTextEditorProps {
  readonly active: boolean
  readonly cell: SceneTableLayoutCell
  readonly transform: TextViewportTransform
  readonly bridgeFactory?: (options: ImeInputBridgeOptions) => ImeInputBridge
}

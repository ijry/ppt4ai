import type { Rect, TextBody } from '@ppt4ai/model'
import type { ImeInputBridge, ImeInputBridgeOptions, TextEditorSelection } from '@ppt4ai/text'
import type { Point, SelectionHandle } from './selection-overlay'
import type { TextViewportTransform } from './text-editor-interaction'

export interface TextBoxEditorProps {
  readonly body: TextBody
  readonly bounds: Rect
  readonly transform: TextViewportTransform
  readonly active: boolean
  readonly selection?: TextEditorSelection
  readonly bridgeFactory?: (options: ImeInputBridgeOptions) => ImeInputBridge
}

export interface TextBoxEditorResizePayload {
  readonly handle: SelectionHandle
  readonly point: Point
}

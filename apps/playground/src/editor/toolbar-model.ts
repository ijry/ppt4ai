import type { PlaygroundPresentationSnapshot } from '../presentation-host'

export interface ToolbarModel {
  canUndo: boolean; canRedo: boolean; canCopy: boolean; canPaste: boolean
  hasSelection: boolean; canGroup: boolean; canUngroup: boolean
}

export function toolbarModel(snapshot: PlaygroundPresentationSnapshot): ToolbarModel {
  const slide = snapshot.slides[snapshot.activeSlideId]
  const selection = slide ? [...slide.engineState.selection] : []
  const elements = slide?.engineState.document.elements ?? {}
  const first = selection[0]
  return {
    canUndo: snapshot.presentationHistory.undoDepth > 0 || (slide?.engineState.history.undoDepth ?? 0) > 0,
    canRedo: snapshot.presentationHistory.redoDepth > 0 || (slide?.engineState.history.redoDepth ?? 0) > 0,
    canCopy: selection.length > 0,
    canPaste: snapshot.clipboard.hasContent,
    hasSelection: selection.length > 0,
    canGroup: selection.length >= 2,
    canUngroup: selection.length === 1 && first !== undefined && elements[first]?.kind === 'group',
  }
}

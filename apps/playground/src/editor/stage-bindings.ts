import type { SceneGraph } from '@ppt4ai/render'
import type { TextBody } from '@ppt4ai/model'
import { normalizeTextElement } from '@ppt4ai/text'
import type { PlaygroundPresentationSnapshot } from '../presentation-host'

export interface StageBindings {
  scene: SceneGraph
  selectedElementId: string | undefined
  selectedElementIds: string[]
  textBodies: Record<string, TextBody>
}

export function stageBindings(snapshot: PlaygroundPresentationSnapshot): StageBindings {
  const slide = snapshot.slides[snapshot.activeSlideId]!
  const selectedElementIds = [...slide.engineState.selection]
  const textBodies: Record<string, TextBody> = {}
  for (const el of Object.values(slide.engineState.document.elements)) {
    const element = el as { id: string; kind: string }
    if (element.kind === 'text') textBodies[element.id] = normalizeTextElement(el as never)
  }
  return {
    scene: slide.thumbnailScene,
    selectedElementId: selectedElementIds.length === 1 ? selectedElementIds[0] : undefined,
    selectedElementIds,
    textBodies,
  }
}

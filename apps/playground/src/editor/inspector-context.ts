import type { PlaygroundPresentationSnapshot } from '../presentation-host'

export type InspectorContext = 'slide' | 'object'

export function inspectorContext(snapshot: PlaygroundPresentationSnapshot): InspectorContext {
  const slide = snapshot.slides[snapshot.activeSlideId]
  const selection = slide ? [...slide.engineState.selection] : []
  return selection.length > 0 ? 'object' : 'slide'
}

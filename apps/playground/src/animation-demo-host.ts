import type { AssetAdapter, Ppt4aiDocument, Rect, SlideTimeline } from '@ppt4ai/model'
import { documentToSceneGraph, type SceneGraph } from '@ppt4ai/render'
import { createSlidePlayer, type OverridePaintTransform, type SlidePlayer, type SlidePlayerOptions } from '@ppt4ai/player'

/** No media in the demo, so the adapter never resolves anything. */
const noopAdapter: AssetAdapter = { get: async () => undefined, put: async () => {} }

function demoDocument(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_animation_demo',
    page: { w: 9144000, h: 5143500 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_1', 'el_2', 'el_3'] } },
    elements: {
      el_1: { id: 'el_1', kind: 'shape', preset: 'rect', bounds: { x: 900000, y: 800000, w: 2400000, h: 1200000 }, fill: { color: { type: 'srgb', v: '4472C4' } } },
      el_2: { id: 'el_2', kind: 'shape', preset: 'ellipse', bounds: { x: 3900000, y: 800000, w: 2400000, h: 1200000 }, fill: { color: { type: 'srgb', v: 'ED7D31' } } },
      el_3: { id: 'el_3', kind: 'shape', preset: 'roundRect', bounds: { x: 2400000, y: 2600000, w: 2400000, h: 1200000 }, fill: { color: { type: 'srgb', v: '70AD47' } } },
    },
    slideOrder: ['sld_1'],
  }
}

/** Three click steps: a fade entrance, a fly-in entrance, then a spin emphasis. */
const demoTimeline: SlideTimeline = {
  mainSeq: [
    { trigger: 'onClick', items: [{ targetId: 'el_1', class: 'entrance', preset: 'fade', duration: 600, params: { easing: 'easeOut' } }] },
    { trigger: 'onClick', items: [{ targetId: 'el_2', class: 'entrance', preset: 'fly', duration: 600, params: { easing: 'easeOut', direction: 'fromLeft' } }] },
    { trigger: 'onClick', items: [{ targetId: 'el_3', class: 'emphasis', preset: 'spin', duration: 800 }] },
  ],
}

type PlayerTiming = Partial<Pick<SlidePlayerOptions, 'now' | 'scheduleFrame' | 'cancelFrame'>>

export interface AnimationDemo {
  scene: SceneGraph
  adapter: AssetAdapter
  timeline: SlideTimeline
  boundsById: (nodeId: string) => Rect | undefined
  /** Build a player for this demo, wiring the frame callback (the injectable timing is for tests). */
  createPlayer(onFrame: (overrides: Map<string, OverridePaintTransform>) => void, timing?: PlayerTiming): SlidePlayer
}

export function createAnimationDemo(): AnimationDemo {
  const scene = documentToSceneGraph(demoDocument())
  const boundsById = (nodeId: string): Rect | undefined => scene.nodes.find((node) => node.id === nodeId)?.bounds
  return {
    scene,
    adapter: noopAdapter,
    timeline: demoTimeline,
    boundsById,
    createPlayer(onFrame, timing) {
      return createSlidePlayer({ timeline: demoTimeline, boundsById, onFrame, ...(timing ?? {}) })
    },
  }
}

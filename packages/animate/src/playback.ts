import type { AnimationBuild, AnimationItem } from '@ppt4ai/model'

/**
 * A per-element override the player lays over the SceneGraph — never mutating the document (§5.2).
 * Offsets are a fraction of the element's own box (`1` = one full width/height), so the caller scales
 * them by the element bounds at paint time; `opacity` is 0..1 and `scale` is a multiplier about centre.
 */
export interface ElementOverride {
  opacity?: number
  offsetXRatio?: number
  offsetYRatio?: number
  scale?: number
}

export type Easing = (t: number) => number

export const EASINGS: Record<string, Easing> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => t * (2 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** The direction an entrance flies in *from*, as a unit offset applied at progress 0 and eased to 0. */
const DIRECTION_OFFSETS: Record<string, { x: number; y: number }> = {
  fromLeft: { x: -1, y: 0 },
  fromRight: { x: 1, y: 0 },
  fromTop: { x: 0, y: -1 },
  fromBottom: { x: 0, y: 1 },
  fromTopLeft: { x: -1, y: -1 },
  fromTopRight: { x: 1, y: -1 },
  fromBottomLeft: { x: -1, y: 1 },
  fromBottomRight: { x: 1, y: 1 },
}

/**
 * The override for a single entrance/exit/emphasis preset at eased progress `p` (0..1). Unknown presets
 * fall back to a fade, which is what a reader shows for an effect it does not implement rather than
 * popping the element in with no animation. Motion paths are not modeled here yet.
 */
function presetOverride(item: AnimationItem, p: number): ElementOverride {
  const eased = (EASINGS[item.params?.easing ?? 'easeOut'] ?? EASINGS.easeOut!)(p)
  const direction = item.params?.direction
  const offset = direction ? DIRECTION_OFFSETS[direction] : undefined
  if (item.class === 'entrance') {
    switch (item.preset) {
      case 'appear':
        return { opacity: p >= 1 ? 1 : 0 }
      case 'fly':
      case 'flyIn': {
        const d = offset ?? DIRECTION_OFFSETS.fromBottom!
        return { opacity: eased, offsetXRatio: d.x * (1 - eased), offsetYRatio: d.y * (1 - eased) }
      }
      case 'zoom':
        return { opacity: eased, scale: 0.01 + 0.99 * eased }
      case 'fade':
      default:
        return { opacity: eased }
    }
  }
  if (item.class === 'exit') {
    switch (item.preset) {
      case 'disappear':
        return { opacity: p >= 1 ? 0 : 1 }
      case 'fly':
      case 'flyOut': {
        const d = offset ?? DIRECTION_OFFSETS.fromBottom!
        return { opacity: 1 - eased, offsetXRatio: d.x * eased, offsetYRatio: d.y * eased }
      }
      case 'zoom':
        return { opacity: 1 - eased, scale: 1 - 0.99 * eased }
      case 'fade':
      default:
        return { opacity: 1 - eased }
    }
  }
  // Emphasis (and anything else): a pulse that returns to identity, so it composes cleanly at the ends.
  return {}
}

/** The state an entrance element sits in before it starts (hidden) and an exit element after it ends. */
function restingOverride(item: AnimationItem, before: boolean): ElementOverride | undefined {
  if (item.class === 'entrance') return before ? { opacity: 0 } : undefined
  if (item.class === 'exit') return before ? undefined : { opacity: 0 }
  return undefined
}

/**
 * The overrides for one build (one trigger group) at `timeMs` from the build's own start. Each item runs
 * over `[delay, delay + duration]`; before/after that it holds its resting state. Multiple items on one
 * target compose by last-write, matching the sequential authoring order.
 */
export function buildOverridesAt(build: AnimationBuild, timeMs: number): Map<string, ElementOverride> {
  const result = new Map<string, ElementOverride>()
  for (const item of build.items) {
    const delay = item.delay ?? 0
    const duration = item.duration ?? 0
    let override: ElementOverride | undefined
    if (timeMs < delay) override = restingOverride(item, true)
    else if (duration <= 0 || timeMs >= delay + duration) override = restingOverride(item, false)
    else override = presetOverride(item, clamp01((timeMs - delay) / duration))
    if (override) result.set(item.targetId, override)
  }
  return result
}

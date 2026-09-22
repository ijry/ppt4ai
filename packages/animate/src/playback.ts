import type { AnimationBuild, AnimationItem, SlideTimeline } from '@ppt4ai/model'

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
  /** Degrees clockwise about the element's centre; the paint layer rotates around the box centre. */
  rotation?: number
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

/** A numeric preset param (params are stored as strings for the file), falling back when absent or unparseable. */
function paramNumber(item: AnimationItem, key: string, fallback: number): number {
  const n = Number(item.params?.[key])
  return Number.isFinite(n) ? n : fallback
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
 * The override for a single entrance/exit/emphasis preset at eased progress `p` (0..1). Unknown
 * entrance/exit presets fall back to a fade — a reader should degrade to a fade rather than pop the
 * element in with no animation; unknown emphasis presets stay at identity. Motion paths are not modeled
 * here yet.
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
  // Emphasis: effects that leave the element at identity at both ends, so they compose cleanly with the
  // resting state before/after. `wave` is a there-and-back (0 at the ends, 1 at the middle) for the
  // effects that grow then return; `spin` ramps monotonically to a full turn. Unknown emphasis presets
  // stay at identity rather than falling back to fade — dimming an element is wrong for an emphasis.
  const wave = Math.sin(Math.PI * eased)
  switch (item.preset) {
    case 'spin':
    case 'spinner':
      return { rotation: paramNumber(item, 'degrees', 360) * eased }
    case 'teeter':
      // A small wobble either side of upright, returning to 0 at the ends.
      return { rotation: paramNumber(item, 'degrees', 8) * Math.sin(2 * Math.PI * eased) }
    case 'grow':
    case 'growShrink':
    case 'grow/shrink':
      return { scale: 1 + (paramNumber(item, 'amount', 1.5) - 1) * wave }
    case 'pulse':
      return { opacity: 1 - clamp01(paramNumber(item, 'amount', 1)) * wave }
    default:
      return {}
  }
}

/** The state an entrance element sits in before it starts (hidden) and an exit element after it ends. */
function restingOverride(item: AnimationItem, before: boolean): ElementOverride | undefined {
  if (item.class === 'entrance') return before ? { opacity: 0 } : undefined
  if (item.class === 'exit') return before ? undefined : { opacity: 0 }
  return undefined
}

/** The override for one item at `timeMs` relative to the item's own start (before its delay is applied). */
function itemOverrideAt(item: AnimationItem, timeMs: number): ElementOverride | undefined {
  const delay = item.delay ?? 0
  const duration = item.duration ?? 0
  if (timeMs < delay) return restingOverride(item, true)
  if (duration <= 0 || timeMs >= delay + duration) return restingOverride(item, false)
  return presetOverride(item, clamp01((timeMs - delay) / duration))
}

/**
 * The overrides for one build (one trigger group) at `timeMs` from the build's own start. Each item runs
 * over `[delay, delay + duration]`; before/after that it holds its resting state. Multiple items on one
 * target compose by last-write, matching the sequential authoring order.
 */
export function buildOverridesAt(build: AnimationBuild, timeMs: number): Map<string, ElementOverride> {
  const result = new Map<string, ElementOverride>()
  for (const item of build.items) {
    const override = itemOverrideAt(item, timeMs)
    if (override) result.set(item.targetId, override)
  }
  return result
}

/** How long a build occupies the timeline: the latest end across its items. */
function buildDuration(build: AnimationBuild): number {
  let max = 0
  for (const item of build.items) max = Math.max(max, (item.delay ?? 0) + (item.duration ?? 0))
  return max
}

/** A build placed on its step's local clock, plus the step it belongs to. */
export interface PlannedBuild {
  build: AnimationBuild
  /** Milliseconds from the step start when this build begins. */
  startMs: number
}

export interface TimelineStep {
  builds: PlannedBuild[]
  /** The step's total length: the latest build end. */
  durationMs: number
}

/**
 * Split a main sequence into click-advanced steps. A step begins at each `onClick` build (and always at
 * the first build); `withPrev` starts with the previous build, `afterPrev` starts when it ends. Within a
 * build, items keep their own delays. The result is a seekable set of steps for the player.
 */
export function planTimeline(timeline: SlideTimeline): TimelineStep[] {
  const steps: TimelineStep[] = []
  let current: PlannedBuild[] | undefined
  let previousStart = 0
  let previousDuration = 0
  timeline.mainSeq.forEach((build, index) => {
    const isLeader = index === 0 || build.trigger === 'onClick'
    let startMs: number
    if (isLeader) {
      current = []
      steps.push({ builds: current, durationMs: 0 })
      startMs = 0
    } else if (build.trigger === 'withPrev') {
      startMs = previousStart
    } else {
      startMs = previousStart + previousDuration
    }
    current!.push({ build, startMs })
    previousStart = startMs
    previousDuration = buildDuration(build)
    const step = steps[steps.length - 1]!
    step.durationMs = Math.max(step.durationMs, startMs + previousDuration)
  })
  return steps
}

/**
 * The overrides at a point in a planned timeline: every step before `stepIndex` is applied at its end
 * (so an element that already entered stays put and one that already exited stays hidden), then the
 * current step at `timeMs` into it. Composed by last-write in step then build order.
 */
export function timelineOverridesAt(steps: TimelineStep[], stepIndex: number, timeMs: number): Map<string, ElementOverride> {
  const result = new Map<string, ElementOverride>()
  const apply = (step: TimelineStep, localTime: number): void => {
    for (const planned of step.builds) {
      for (const [id, override] of buildOverridesAt(planned.build, localTime - planned.startMs)) result.set(id, override)
    }
  }
  const clampedStep = Math.max(0, Math.min(stepIndex, steps.length))
  for (let i = 0; i < clampedStep && i < steps.length; i += 1) apply(steps[i]!, steps[i]!.durationMs)
  if (clampedStep < steps.length) apply(steps[clampedStep]!, timeMs)
  return result
}

/**
 * The interactive builds a click on `triggerId` fires. Unlike the main sequence these are not part of the
 * click-through steps: each is its own little timeline the player runs from zero (via `buildOverridesAt`)
 * when its shape is clicked. A shape may drive more than one build; document order is preserved.
 */
export function interactiveBuildsFor(timeline: SlideTimeline, triggerId: string): AnimationBuild[] {
  return (timeline.interactiveSeq ?? []).filter((build) => build.triggerId === triggerId)
}

import type { Rect, SlideTimeline } from '@ppt4ai/model'
import { planTimeline, timelineOverridesAt, type ElementOverride, type TimelineStep } from '@ppt4ai/animate'

/**
 * The resolved paint transform for one element — the `ElementOverride` (fractions of the box, a multiplier
 * about centre, degrees) turned into paint-ready numbers against concrete bounds. Identity when there is
 * no override, so the caller can apply it unconditionally. Offsets come back in the same unit as `bounds`
 * (EMU); the paint layer maps that to pixels alongside the element's own transform.
 */
export interface OverridePaintTransform {
  /** 0..1, multiplied into the element's alpha. */
  opacity: number
  /** Translation in bounds units (EMU). */
  translateX: number
  translateY: number
  /** Multiplier about the box centre. */
  scale: number
  /** Degrees clockwise about the box centre. */
  rotationDeg: number
}

export function overridePaintTransform(bounds: Rect, override: ElementOverride | undefined): OverridePaintTransform {
  return {
    opacity: override?.opacity ?? 1,
    translateX: (override?.offsetXRatio ?? 0) * bounds.w,
    translateY: (override?.offsetYRatio ?? 0) * bounds.h,
    scale: override?.scale ?? 1,
    rotationDeg: override?.rotation ?? 0,
  }
}

/**
 * A slide's playback position: which click-step is current, how far into it we are, and whether it is
 * animating. Pure and serialisable — an rAF driver owns the wall-clock and calls `tick`, but every
 * transition here is a plain function so it can be unit-tested without a loop. `stepIndex === steps.length`
 * means every step has finished (the slide's end state).
 */
export interface PlaybackState {
  readonly steps: readonly TimelineStep[]
  readonly stepIndex: number
  readonly elapsedMs: number
  readonly playing: boolean
}

export function createPlayback(timeline: SlideTimeline): PlaybackState {
  return { steps: planTimeline(timeline), stepIndex: 0, elapsedMs: 0, playing: false }
}

/** The length of the current step, or 0 once every step has finished. */
export function currentStepDurationMs(state: PlaybackState): number {
  return state.steps[state.stepIndex]?.durationMs ?? 0
}

/** The overrides to lay over the scene at the current position. */
export function overridesFor(state: PlaybackState): Map<string, ElementOverride> {
  return timelineOverridesAt(state.steps as TimelineStep[], state.stepIndex, state.elapsedMs)
}

/** True once the last step has finished and there is nothing left to advance to. */
export function isFinished(state: PlaybackState): boolean {
  return state.stepIndex >= state.steps.length
}

export function play(state: PlaybackState): PlaybackState {
  return state.playing || isFinished(state) ? state : { ...state, playing: true }
}

export function pause(state: PlaybackState): PlaybackState {
  return state.playing ? { ...state, playing: false } : state
}

/**
 * Advance wall-clock time into the current step while playing. Time is clamped to the step's duration and
 * playback stops at the end — the step holds its finished state, waiting for the next `advance` (click).
 */
export function tick(state: PlaybackState, deltaMs: number): PlaybackState {
  if (!state.playing || deltaMs <= 0) return state
  const duration = currentStepDurationMs(state)
  const elapsedMs = Math.min(state.elapsedMs + deltaMs, duration)
  return { ...state, elapsedMs, playing: elapsedMs < duration }
}

/**
 * A click. Three cases: at the start of an unplayed step, begin playing it; part-way through, snap it to
 * its finished state (a click skips the rest); once finished, move to the next step and begin playing it.
 * Past the last step this settles on the end state.
 */
export function advance(state: PlaybackState): PlaybackState {
  if (isFinished(state)) return state
  const duration = currentStepDurationMs(state)
  if (!state.playing && state.elapsedMs === 0) return { ...state, playing: true }
  if (state.elapsedMs < duration) return { ...state, elapsedMs: duration, playing: false }
  const stepIndex = state.stepIndex + 1
  return { ...state, stepIndex, elapsedMs: 0, playing: stepIndex < state.steps.length }
}

/** Jump to a step boundary (its start), not playing — for scrubbing or restart. */
export function seekStep(state: PlaybackState, stepIndex: number): PlaybackState {
  const clamped = Math.max(0, Math.min(stepIndex, state.steps.length))
  return { ...state, stepIndex: clamped, elapsedMs: 0, playing: false }
}

export function reset(state: PlaybackState): PlaybackState {
  return { ...state, stepIndex: 0, elapsedMs: 0, playing: false }
}

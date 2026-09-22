import type { Rect, SlideTimeline } from '@ppt4ai/model'
import {
  advance,
  createPlayback,
  overridePaintTransform,
  overridesFor,
  pause,
  play,
  reset,
  tick,
  type OverridePaintTransform,
  type PlaybackState,
} from './playback'

/** Resolve the current overrides to paint-ready transforms, dropping any element whose bounds are unknown. */
export function paintOverridesFor(
  state: PlaybackState,
  boundsById: (nodeId: string) => Rect | undefined,
  page?: { w: number; h: number },
): Map<string, OverridePaintTransform> {
  const result = new Map<string, OverridePaintTransform>()
  for (const [id, override] of overridesFor(state)) {
    const bounds = boundsById(id)
    if (bounds) result.set(id, overridePaintTransform(bounds, override, page))
  }
  return result
}

export interface SlidePlayerOptions {
  timeline: SlideTimeline
  /** Bounds (EMU) for a node id, used to turn override ratios into concrete offsets. */
  boundsById: (nodeId: string) => Rect | undefined
  /** Slide (page) size in EMU, needed to resolve motion-path (slide-relative) offsets. */
  page?: { w: number; h: number }
  /** Called with the paint transforms for the current instant — hand these to the renderer. */
  onFrame: (overrides: Map<string, OverridePaintTransform>) => void
  /** Injectable for tests; default `performance.now`. */
  now?: () => number
  /** Injectable for tests; default `requestAnimationFrame`. */
  scheduleFrame?: (callback: (time: number) => void) => number
  /** Injectable for tests; default `cancelAnimationFrame`. */
  cancelFrame?: (handle: number) => void
}

export interface SlidePlayer {
  /** Begin (or resume) animating the current step. */
  play(): void
  /** Stop advancing time; the current instant holds. */
  pause(): void
  /** A click: play the current step, or move to and play the next once it has finished. */
  next(): void
  /** Return to the start (before the first click). */
  reset(): void
  /** The current playback position. */
  state(): PlaybackState
  /** Cancel any pending frame; the player must not be used afterwards. */
  dispose(): void
}

/**
 * Drive a slide's animation over wall-clock frames. The only inherently non-headless piece — every
 * transition it makes comes from the pure state machine in `./playback`, and the clock and frame
 * scheduler are injectable so the loop itself is testable without a real `requestAnimationFrame`.
 */
export function createSlidePlayer(options: SlidePlayerOptions): SlidePlayer {
  const now = options.now ?? (() => performance.now())
  const scheduleFrame = options.scheduleFrame ?? ((callback) => requestAnimationFrame(callback))
  const cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle))

  let state = createPlayback(options.timeline)
  let frame: number | undefined
  let lastTime = 0

  const emit = (): void => options.onFrame(paintOverridesFor(state, options.boundsById, options.page))

  const schedule = (): void => {
    if (frame === undefined) frame = scheduleFrame(loop)
  }

  function loop(time: number): void {
    frame = undefined
    state = tick(state, time - lastTime)
    lastTime = time
    emit()
    if (state.playing) schedule()
  }

  const stopFrame = (): void => {
    if (frame !== undefined) {
      cancelFrame(frame)
      frame = undefined
    }
  }

  // Paint the initial resting state (entrances hidden) before anything plays.
  emit()

  return {
    play(): void {
      state = play(state)
      if (state.playing) {
        lastTime = now()
        schedule()
      }
    },
    pause(): void {
      state = pause(state)
      stopFrame()
    },
    next(): void {
      state = advance(state)
      lastTime = now()
      emit()
      if (state.playing) schedule()
    },
    reset(): void {
      state = reset(state)
      stopFrame()
      emit()
    },
    state: () => state,
    dispose(): void {
      stopFrame()
    },
  }
}

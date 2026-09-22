import type { Rect, SlideTimeline } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createSlidePlayer, type OverridePaintTransform } from './index'

const timeline: SlideTimeline = {
  mainSeq: [{ trigger: 'onClick', items: [{ targetId: 'el_1', class: 'entrance', preset: 'fade', duration: 500, params: { easing: 'linear' } }] }],
}

const bounds: Rect = { x: 0, y: 0, w: 1000, h: 500 }
const boundsById = (id: string): Rect | undefined => (id === 'el_1' ? bounds : undefined)

/** A manual frame queue: `run(time)` fires every frame scheduled so far with that timestamp. */
function fakeFrames() {
  let nextHandle = 0
  const pending = new Map<number, (time: number) => void>()
  return {
    schedule(callback: (time: number) => void): number {
      const handle = (nextHandle += 1)
      pending.set(handle, callback)
      return handle
    },
    cancel(handle: number): void { pending.delete(handle) },
    run(time: number): void {
      const callbacks = [...pending.values()]
      pending.clear()
      for (const callback of callbacks) callback(time)
    },
    get pending(): number { return pending.size },
  }
}

function harness() {
  const frames = fakeFrames()
  let clock = 0
  const emitted: Array<Map<string, OverridePaintTransform>> = []
  const player = createSlidePlayer({
    timeline,
    boundsById,
    onFrame: (overrides) => emitted.push(overrides),
    now: () => clock,
    scheduleFrame: (callback) => frames.schedule(callback),
    cancelFrame: (handle) => frames.cancel(handle),
  })
  return { frames, player, emitted, setClock: (value: number) => { clock = value } }
}

describe('createSlidePlayer', () => {
  it('paints the initial resting state (entrance hidden) before playing', () => {
    const { emitted } = harness()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]!.get('el_1')).toEqual({ opacity: 0, translateX: 0, translateY: 0, scale: 1, rotationDeg: 0 })
  })

  it('interpolates the entrance across frames while playing', () => {
    const { frames, player, emitted, setClock } = harness()
    setClock(0)
    player.play()
    frames.run(250)
    expect(player.state()).toMatchObject({ elapsedMs: 250, playing: true })
    expect(emitted.at(-1)!.get('el_1')!.opacity).toBeCloseTo(0.5)
  })

  it('stops scheduling once the step finishes and rests the element', () => {
    const { frames, player, emitted, setClock } = harness()
    setClock(0)
    player.play()
    frames.run(250)
    frames.run(600)
    expect(player.state().playing).toBe(false)
    expect(frames.pending).toBe(0)
    // The entrance has finished, so el_1 rests with no override.
    expect(emitted.at(-1)!.has('el_1')).toBe(false)
  })

  it('pause cancels the pending frame', () => {
    const { frames, player, setClock } = harness()
    setClock(0)
    player.play()
    expect(frames.pending).toBe(1)
    player.pause()
    expect(frames.pending).toBe(0)
    expect(player.state().playing).toBe(false)
  })

  it('next begins playing the current step from a fresh player', () => {
    const { player, emitted, setClock } = harness()
    setClock(0)
    player.next()
    expect(player.state().playing).toBe(true)
    // The click emits immediately at the step start: the entrance is still hidden.
    expect(emitted.at(-1)!.get('el_1')!.opacity).toBe(0)
  })
})

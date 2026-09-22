import type { SlideTimeline } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { advance, createPlayback, isFinished, overridePaintTransform, overridesFor, pause, tick } from './index'

const timeline: SlideTimeline = {
  mainSeq: [
    { trigger: 'onClick', items: [{ targetId: 'el_1', class: 'entrance', preset: 'fade', duration: 500, params: { easing: 'linear' } }] },
    { trigger: 'onClick', items: [{ targetId: 'el_2', class: 'entrance', preset: 'fade', duration: 500, params: { easing: 'linear' } }] },
  ],
}

describe('overridePaintTransform', () => {
  it('turns an override into paint-ready numbers against the bounds', () => {
    const transform = overridePaintTransform(
      { x: 0, y: 0, w: 1000, h: 800 },
      { opacity: 0.5, offsetXRatio: 0.25, offsetYRatio: -0.5, scale: 2, rotation: 90 },
    )
    expect(transform).toEqual({ opacity: 0.5, translateX: 250, translateY: -400, scale: 2, rotationDeg: 90 })
  })

  it('is identity when there is no override', () => {
    expect(overridePaintTransform({ x: 0, y: 0, w: 100, h: 100 }, undefined))
      .toEqual({ opacity: 1, translateX: 0, translateY: 0, scale: 1, rotationDeg: 0 })
  })

  it('resolves a motion (slide-relative) offset against the page size', () => {
    const transform = overridePaintTransform(
      { x: 0, y: 0, w: 100, h: 100 },
      { offsetXSlideRatio: 0.25, offsetYSlideRatio: 0.5 },
      { w: 9144000, h: 6858000 },
    )
    expect(transform.translateX).toBeCloseTo(2286000)
    expect(transform.translateY).toBeCloseTo(3429000)
  })
})

describe('playback state machine', () => {
  it('starts before the first click with entrances hidden and not playing', () => {
    const state = createPlayback(timeline)
    expect(state).toMatchObject({ stepIndex: 0, elapsedMs: 0, playing: false })
    expect(overridesFor(state).get('el_1')).toEqual({ opacity: 0 })
  })

  it('plays the current step on the first advance and interpolates over time', () => {
    const started = advance(createPlayback(timeline))
    expect(started.playing).toBe(true)
    const mid = tick(started, 250)
    expect(mid).toMatchObject({ stepIndex: 0, elapsedMs: 250, playing: true })
    expect(overridesFor(mid).get('el_1')!.opacity).toBeCloseTo(0.5)
  })

  it('clamps time to the step duration and stops at the end', () => {
    const finishedStep = tick(advance(createPlayback(timeline)), 800)
    expect(finishedStep).toMatchObject({ stepIndex: 0, elapsedMs: 500, playing: false })
    expect(overridesFor(finishedStep).get('el_1')).toBeUndefined()
  })

  it('moves to the next step and plays it once the current step has finished', () => {
    const finishedStep = tick(advance(createPlayback(timeline)), 800)
    const nextStep = advance(finishedStep)
    expect(nextStep).toMatchObject({ stepIndex: 1, elapsedMs: 0, playing: true })
    // el_1 stays entered (resting), el_2 is about to enter.
    expect(overridesFor(nextStep).get('el_1')).toBeUndefined()
    expect(overridesFor(nextStep).get('el_2')).toEqual({ opacity: 0 })
  })

  it('snaps a still-animating step to its end when advanced mid-play', () => {
    const midPlay = tick(advance(createPlayback(timeline)), 200)
    const snapped = advance(midPlay)
    expect(snapped).toMatchObject({ stepIndex: 0, elapsedMs: 500, playing: false })
  })

  it('settles on the end state after advancing past the last step', () => {
    let state = createPlayback(timeline)
    for (let i = 0; i < 6; i += 1) state = advance(tick(state, 1000))
    expect(isFinished(state)).toBe(true)
    expect(overridesFor(state).get('el_1')).toBeUndefined()
    expect(overridesFor(state).get('el_2')).toBeUndefined()
  })

  it('pause halts time advancement', () => {
    const paused = pause(tick(advance(createPlayback(timeline)), 100))
    expect(tick(paused, 100)).toEqual(paused)
  })
})

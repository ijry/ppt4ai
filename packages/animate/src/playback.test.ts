import type { AnimationBuild, SlideTimeline } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { buildOverridesAt, EASINGS, interactiveBuildsFor, planTimeline, timelineOverridesAt } from './index'

function build(items: AnimationBuild['items']): AnimationBuild {
  return { trigger: 'onClick', items }
}

describe('buildOverridesAt', () => {
  it('holds an entrance hidden before it starts', () => {
    const b = build([{ targetId: 'el_1', class: 'entrance', preset: 'fade', delay: 100, duration: 500 }])
    expect(buildOverridesAt(b, 0).get('el_1')).toEqual({ opacity: 0 })
  })

  it('fades an entrance in over its duration and rests visible after', () => {
    const b = build([{ targetId: 'el_1', class: 'entrance', preset: 'fade', duration: 500, params: { easing: 'linear' } }])
    expect(buildOverridesAt(b, 250).get('el_1')).toEqual({ opacity: 0.5 })
    expect(buildOverridesAt(b, 600).get('el_1')).toBeUndefined()
  })

  it('flies an entrance in from a direction, easing the offset to zero', () => {
    const b = build([{ targetId: 'el_1', class: 'entrance', preset: 'fly', duration: 500, params: { easing: 'linear', direction: 'fromLeft' } }])
    const mid = buildOverridesAt(b, 250).get('el_1')!
    expect(mid.opacity).toBeCloseTo(0.5)
    expect(mid.offsetXRatio).toBeCloseTo(-0.5)
    expect(mid.offsetYRatio).toBeCloseTo(0)
  })

  it('holds an exit visible before it starts, animates out, and rests hidden after', () => {
    const b = build([{ targetId: 'el_1', class: 'exit', preset: 'fade', delay: 100, duration: 400, params: { easing: 'linear' } }])
    expect(buildOverridesAt(b, 0).get('el_1')).toBeUndefined()
    expect(buildOverridesAt(b, 300).get('el_1')!.opacity).toBeCloseTo(0.5)
    expect(buildOverridesAt(b, 600).get('el_1')).toEqual({ opacity: 0 })
  })

  it('lets a later item on the same target win (sequential authoring)', () => {
    const b = build([
      { targetId: 'el_1', class: 'entrance', preset: 'fade', duration: 100 },
      { targetId: 'el_1', class: 'exit', preset: 'fade', duration: 100, delay: 100, params: { easing: 'linear' } },
    ])
    expect(buildOverridesAt(b, 150).get('el_1')!.opacity).toBeCloseTo(0.5)
  })

  it('treats a zero-duration entrance as no override at its start', () => {
    const b = build([{ targetId: 'el_1', class: 'entrance', preset: 'fade', duration: 0 }])
    expect(buildOverridesAt(b, 0).get('el_1')).toBeUndefined()
  })

  it('exposes standard easings', () => {
    expect(EASINGS.linear!(0.5)).toBe(0.5)
    expect(EASINGS.easeOut!(0)).toBe(0)
    expect(EASINGS.easeOut!(1)).toBe(1)
  })
})

describe('emphasis presets', () => {
  it('spins toward a full turn and rests upright after', () => {
    const b = build([{ targetId: 'el_1', class: 'emphasis', preset: 'spin', duration: 500, params: { easing: 'linear' } }])
    expect(buildOverridesAt(b, 250).get('el_1')).toEqual({ rotation: 180 })
    expect(buildOverridesAt(b, 600).get('el_1')).toBeUndefined()
  })

  it('teeters either side of upright and returns to zero at the ends', () => {
    const b = build([{ targetId: 'el_1', class: 'emphasis', preset: 'teeter', duration: 400, params: { easing: 'linear' } }])
    expect(buildOverridesAt(b, 100).get('el_1')!.rotation).toBeCloseTo(8)
    expect(buildOverridesAt(b, 200).get('el_1')!.rotation).toBeCloseTo(0)
  })

  it('grows to a peak scale at the middle and back to identity', () => {
    const b = build([{ targetId: 'el_1', class: 'emphasis', preset: 'grow', duration: 500, params: { easing: 'linear' } }])
    expect(buildOverridesAt(b, 250).get('el_1')!.scale).toBeCloseTo(1.5)
    expect(buildOverridesAt(b, 500).get('el_1')).toBeUndefined()
  })

  it('honours a custom grow amount', () => {
    const b = build([{ targetId: 'el_1', class: 'emphasis', preset: 'grow', duration: 500, params: { easing: 'linear', amount: '2' } }])
    expect(buildOverridesAt(b, 250).get('el_1')!.scale).toBeCloseTo(2)
  })

  it('pulses opacity down and back', () => {
    const b = build([{ targetId: 'el_1', class: 'emphasis', preset: 'pulse', duration: 500, params: { easing: 'linear' } }])
    expect(buildOverridesAt(b, 250).get('el_1')!.opacity).toBeCloseTo(0)
    expect(buildOverridesAt(b, 125).get('el_1')!.opacity).toBeCloseTo(1 - Math.SQRT1_2)
  })

  it('leaves an unknown emphasis at identity instead of fading it', () => {
    const b = build([{ targetId: 'el_1', class: 'emphasis', preset: 'colorPulse', duration: 500 }])
    expect(buildOverridesAt(b, 250).get('el_1')).toEqual({})
  })

  it('does not hold an emphasis element hidden at rest', () => {
    const b = build([{ targetId: 'el_1', class: 'emphasis', preset: 'spin', delay: 100, duration: 400 }])
    expect(buildOverridesAt(b, 0).get('el_1')).toBeUndefined()
    expect(buildOverridesAt(b, 600).get('el_1')).toBeUndefined()
  })
})

describe('motion path', () => {
  const motion = (path: string) => build([{ targetId: 'el_1', class: 'motion', preset: 'custom', duration: 1000, params: { path, easing: 'linear' } }])

  it('offsets along the path as a fraction of the slide', () => {
    const b = motion('M 0 0 L 0.5 0.25 E')
    expect(b.items[0]!.class).toBe('motion')
    expect(buildOverridesAt(b, 0).get('el_1')).toEqual({ offsetXSlideRatio: 0, offsetYSlideRatio: 0 })
    const mid = buildOverridesAt(b, 500).get('el_1')!
    expect(mid.offsetXSlideRatio).toBeCloseTo(0.25)
    expect(mid.offsetYSlideRatio).toBeCloseTo(0.125)
  })

  it('holds the element at the path end after it finishes', () => {
    const at = buildOverridesAt(motion('M 0 0 L 0.5 0.25 E'), 1500).get('el_1')!
    expect(at.offsetXSlideRatio).toBeCloseTo(0.5)
    expect(at.offsetYSlideRatio).toBeCloseTo(0.25)
  })

  it('reads relative commands as offsets from the current point', () => {
    // m 0.1 0.1 then l 0.2 0 -> endpoint (0.3, 0.1); midpoint offset from start (0.1,0.1) is (0.1, 0).
    const mid = buildOverridesAt(motion('m 0.1 0.1 l 0.2 0 e'), 500).get('el_1')!
    expect(mid.offsetXSlideRatio).toBeCloseTo(0.1)
    expect(mid.offsetYSlideRatio).toBeCloseTo(0)
  })
})

describe('planTimeline', () => {
  it('opens a step at the first build and at every onClick', () => {
    const timeline: SlideTimeline = {
      mainSeq: [
        { trigger: 'onClick', items: [{ targetId: 'el_1', class: 'entrance', preset: 'fade', duration: 500 }] },
        { trigger: 'onClick', items: [{ targetId: 'el_2', class: 'entrance', preset: 'fade', duration: 500 }] },
      ],
    }
    const steps = planTimeline(timeline)
    expect(steps).toHaveLength(2)
    expect(steps[0]!.builds).toHaveLength(1)
    expect(steps[0]!.builds[0]!.startMs).toBe(0)
    expect(steps[1]!.builds[0]!.startMs).toBe(0)
  })

  it('starts withPrev with the previous build and afterPrev when it ends, inside one step', () => {
    const timeline: SlideTimeline = {
      mainSeq: [
        { trigger: 'onClick', items: [{ targetId: 'el_1', class: 'entrance', preset: 'fade', duration: 500 }] },
        { trigger: 'withPrev', items: [{ targetId: 'el_2', class: 'entrance', preset: 'fade', duration: 300 }] },
        { trigger: 'afterPrev', items: [{ targetId: 'el_3', class: 'entrance', preset: 'fade', duration: 200 }] },
      ],
    }
    const steps = planTimeline(timeline)
    expect(steps).toHaveLength(1)
    expect(steps[0]!.builds.map((b) => b.startMs)).toEqual([0, 0, 300])
    // Latest end across items: el_1 ends at 500, el_3 at 300+200=500.
    expect(steps[0]!.durationMs).toBe(500)
  })

  it('measures a build by the latest end across its items, including per-item delay', () => {
    const timeline: SlideTimeline = {
      mainSeq: [
        {
          trigger: 'onClick',
          items: [
            { targetId: 'el_1', class: 'entrance', preset: 'fade', duration: 200 },
            { targetId: 'el_2', class: 'entrance', preset: 'fade', delay: 400, duration: 300 },
          ],
        },
        { trigger: 'afterPrev', items: [{ targetId: 'el_3', class: 'entrance', preset: 'fade', duration: 100 }] },
      ],
    }
    const steps = planTimeline(timeline)
    expect(steps).toHaveLength(1)
    // First build ends at max(200, 400+300) = 700, so afterPrev starts at 700.
    expect(steps[0]!.builds[1]!.startMs).toBe(700)
    expect(steps[0]!.durationMs).toBe(800)
  })
})

describe('timelineOverridesAt', () => {
  const timeline: SlideTimeline = {
    mainSeq: [
      { trigger: 'onClick', items: [{ targetId: 'el_1', class: 'entrance', preset: 'fade', duration: 500, params: { easing: 'linear' } }] },
      {
        trigger: 'onClick',
        items: [
          { targetId: 'el_1', class: 'exit', preset: 'fade', duration: 500, params: { easing: 'linear' } },
          { targetId: 'el_2', class: 'entrance', preset: 'fade', duration: 500, params: { easing: 'linear' } },
        ],
      },
    ],
  }
  const steps = planTimeline(timeline)

  it('holds an entrance hidden before the first click', () => {
    const at = timelineOverridesAt(steps, -1, 0)
    expect(at.get('el_1')).toEqual({ opacity: 0 })
  })

  it('pre-hides an entrance that belongs to a not-yet-reached step', () => {
    // el_2 enters in step 1; at step 0 it must already be hidden, not shown at full.
    const at = timelineOverridesAt(steps, 0, 0)
    expect(at.get('el_2')).toEqual({ opacity: 0 })
  })

  it('rests a finished entrance and drives the current step from its start', () => {
    const at = timelineOverridesAt(steps, 1, 0)
    // el_1 fully entered in step 0 (resting, no override there) and is about to exit at full opacity.
    expect(at.get('el_1')).toEqual({ opacity: 1 })
    // el_2 has not entered yet.
    expect(at.get('el_2')).toEqual({ opacity: 0 })
  })

  it('interpolates within the current step', () => {
    const at = timelineOverridesAt(steps, 1, 250)
    expect(at.get('el_1')!.opacity).toBeCloseTo(0.5)
    expect(at.get('el_2')!.opacity).toBeCloseTo(0.5)
  })

  it('applies every step at its end when seeked past the last step', () => {
    const at = timelineOverridesAt(steps, 2, 0)
    // el_1 has exited (rests hidden); el_2 has entered (rests visible, no override).
    expect(at.get('el_1')).toEqual({ opacity: 0 })
    expect(at.get('el_2')).toBeUndefined()
  })
})

describe('interactiveBuildsFor', () => {
  const timeline: SlideTimeline = {
    mainSeq: [{ trigger: 'onClick', items: [{ targetId: 'el_1', class: 'entrance', preset: 'fade' }] }],
    interactiveSeq: [
      { trigger: 'onClick', triggerId: 'btn', items: [{ targetId: 'el_2', class: 'entrance', preset: 'fade' }] },
      { trigger: 'onClick', triggerId: 'other', items: [{ targetId: 'el_3', class: 'entrance', preset: 'fade' }] },
      { trigger: 'onClick', triggerId: 'btn', items: [{ targetId: 'el_4', class: 'exit', preset: 'fade' }] },
    ],
  }

  it('returns every interactive build a shape triggers, in document order', () => {
    const builds = interactiveBuildsFor(timeline, 'btn')
    expect(builds.map((b) => b.items[0]!.targetId)).toEqual(['el_2', 'el_4'])
  })

  it('returns nothing for a shape that triggers no build', () => {
    expect(interactiveBuildsFor(timeline, 'nobody')).toEqual([])
  })

  it('never returns main-sequence builds', () => {
    expect(interactiveBuildsFor({ mainSeq: timeline.mainSeq }, 'btn')).toEqual([])
  })
})

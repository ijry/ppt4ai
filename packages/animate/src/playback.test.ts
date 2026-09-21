import type { AnimationBuild } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { buildOverridesAt, EASINGS } from './index'

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

import type { OverridePaintTransform } from '@ppt4ai/player'
import { describe, expect, it } from 'vitest'
import { createAnimationDemo } from './animation-demo-host'

function fakeFrames() {
  let handle = 0
  const pending = new Map<number, (time: number) => void>()
  return {
    schedule(callback: (time: number) => void): number { const id = (handle += 1); pending.set(id, callback); return id },
    cancel(id: number): void { pending.delete(id) },
    run(time: number): void {
      const callbacks = [...pending.values()]
      pending.clear()
      for (const callback of callbacks) callback(time)
    },
  }
}

describe('animation demo host', () => {
  it('builds a scene whose nodes match the timeline targets', () => {
    const demo = createAnimationDemo()
    const ids = demo.scene.nodes.map((node) => node.id)
    expect(ids).toEqual(['el_1', 'el_2', 'el_3'])
    for (const build of demo.timeline.mainSeq) {
      for (const item of build.items) {
        expect(ids).toContain(item.targetId)
        expect(demo.boundsById(item.targetId)).toBeDefined()
      }
    }
  })

  it('hides the first step entrance and any pending entrance on the initial frame', () => {
    const demo = createAnimationDemo()
    const frames: Array<Map<string, OverridePaintTransform>> = []
    demo.createPlayer((overrides) => frames.push(overrides))
    const initial = frames[0]!
    expect(initial.get('el_1')).toMatchObject({ opacity: 0 })
    expect(initial.get('el_2')).toMatchObject({ opacity: 0 })
    // el_3 is an emphasis, visible at rest, so it carries no override.
    expect(initial.has('el_3')).toBe(false)
  })

  it('interpolates the first step after a click, under a fake clock', () => {
    const demo = createAnimationDemo()
    const frames: Array<Map<string, OverridePaintTransform>> = []
    const clock = { value: 0 }
    const fake = fakeFrames()
    const player = demo.createPlayer(
      (overrides) => frames.push(overrides),
      { now: () => clock.value, scheduleFrame: fake.schedule, cancelFrame: fake.cancel },
    )
    player.next()
    fake.run(300)
    const opacity = frames.at(-1)!.get('el_1')!.opacity
    expect(opacity).toBeGreaterThan(0)
    expect(opacity).toBeLessThan(1)
    player.dispose()
  })
})

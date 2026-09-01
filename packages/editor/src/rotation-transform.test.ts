import { describe, expect, it, vi } from 'vitest'
import { withRotation } from './rotation-transform'

function recordingContext() {
  const calls: string[] = []
  return {
    calls,
    context: {
      save: vi.fn(() => void calls.push('save')),
      restore: vi.fn(() => void calls.push('restore')),
      translate: vi.fn((x: number, y: number) => void calls.push(`translate(${x},${y})`)),
      rotate: vi.fn((angle: number) => void calls.push(`rotate(${angle.toFixed(4)})`)),
    } as unknown as CanvasRenderingContext2D,
  }
}

const bounds = { x: 100, y: 200, w: 40, h: 20 }

describe('withRotation', () => {
  it('draws in place without touching the transform when rotation is absent', () => {
    const { calls, context } = recordingContext()

    withRotation(context, bounds, undefined, () => void calls.push('draw'))

    expect(calls).toEqual(['draw'])
  })

  it('draws in place when rotation is zero', () => {
    const { calls, context } = recordingContext()

    withRotation(context, bounds, { rotation: 0 }, () => void calls.push('draw'))

    expect(calls).toEqual(['draw'])
  })

  it('rotates about the bounds centre and draws at the local origin', () => {
    const { calls, context } = recordingContext()

    withRotation(context, bounds, { rotation: 5400000 }, () => void calls.push('draw'))

    expect(calls).toEqual([
      'save',
      'translate(120,210)',
      `rotate(${(Math.PI / 2).toFixed(4)})`,
      'translate(-120,-210)',
      'draw',
      'restore',
    ])
  })

  it('ignores flips, which do not change the painted coverage for shape and text', () => {
    const { calls, context } = recordingContext()

    withRotation(context, bounds, { rotation: 0, flipH: true, flipV: true }, () => void calls.push('draw'))

    expect(calls).toEqual(['draw'])
  })

  it('restores the context even when the draw callback throws', () => {
    const { calls, context } = recordingContext()

    expect(() => withRotation(context, bounds, { rotation: 5400000 }, () => {
      throw new Error('draw failed')
    })).toThrow('draw failed')
    expect(calls.at(-1)).toBe('restore')
  })
})

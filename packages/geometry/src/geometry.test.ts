import { describe, expect, it } from 'vitest'
import { createPresetPath, type GeometryBounds } from './index'

const bounds: GeometryBounds = { x: 10, y: 20, w: 100, h: 50 }

describe('preset geometry', () => {
  it('creates a closed rectangle path in source coordinates', () => {
    expect(createPresetPath('rect', bounds)).toEqual([
      { type: 'move', x: 10, y: 20 },
      { type: 'line', x: 110, y: 20 },
      { type: 'line', x: 110, y: 70 },
      { type: 'line', x: 10, y: 70 },
      { type: 'close' },
    ])
  })

  it('keeps all preset outputs finite and closed', () => {
    for (const preset of ['rect', 'roundRect', 'ellipse', 'triangle'] as const) {
      const path = createPresetPath(preset, { x: 0, y: 0, w: 120, h: 80 })
      expect(path.at(-1)).toEqual({ type: 'close' })
      expect(JSON.stringify(path)).not.toContain('null')
    }
  })

  it('clamps round rectangle radius to the shorter side', () => {
    const path = createPresetPath('roundRect', { x: 0, y: 0, w: 20, h: 10 })
    expect(path).toContainEqual(expect.objectContaining({ type: 'arc', cx: 5, cy: 5, rx: 5, ry: 5 }))
  })
})

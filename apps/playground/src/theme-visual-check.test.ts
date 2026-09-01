import { describe, expect, it } from 'vitest'
import { documentToSceneGraph } from '@ppt4ai/render'
import { createPlaygroundPresentationHost } from './presentation-host'

function shapeFill(host: ReturnType<typeof createPlaygroundPresentationHost>): unknown {
  const document = host.getSnapshot().slides.sld_playground!.engineState.document
  const node = documentToSceneGraph(document).nodes.find((entry) => entry.id === 'shape_demo')
  if (!node) throw new Error('seeded shape_demo is missing from the scene graph')
  return (node as { resolvedFillColor?: unknown }).resolvedFillColor
}

describe('playground theme edits change rendered colour', () => {
  it('repaints the seeded scheme-coloured shape when accent1 changes', () => {
    const host = createPlaygroundPresentationHost()

    const before = shapeFill(host)
    host.setThemeColor('accent1', { type: 'srgb', v: 'FF0000' })
    const after = shapeFill(host)

    expect(before).not.toEqual(after)
    expect(JSON.stringify(after)).toContain('FF0000')
  })

  it('returns the shape to the Office default accent when reset', () => {
    const host = createPlaygroundPresentationHost()
    host.setThemeColor('accent1', { type: 'srgb', v: 'FF0000' })

    host.setThemeColor('accent1', null)

    expect(JSON.stringify(shapeFill(host))).toContain('4472C4')
  })
})

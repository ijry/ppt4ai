import { documentToSceneGraph } from '@ppt4ai/render'
import { describe, expect, it } from 'vitest'
import { createPlaygroundAssetHost } from './asset-host'

/**
 * The background pipeline (model → scene → paint → export) was already complete; this covers the entry
 * point the slice added, and asserts on the *resolved* scene colour rather than on the model field, so
 * a wiring change that stops reaching the canvas would fail here.
 */
function backgroundOf(host: ReturnType<typeof createPlaygroundAssetHost>): string | undefined {
  const document = host.getSnapshot().engineState.document
  return documentToSceneGraph(document).background?.rgb
}

describe('playground slide background wiring', () => {
  it('paints the picked colour and reports it', () => {
    const host = createPlaygroundAssetHost()

    const snapshot = host.setSlideBackground({ fill: { color: { type: 'srgb', v: '1F3864' } } })

    expect(snapshot.status).toEqual({ kind: 'success', message: 'slide-background-updated' })
    expect(backgroundOf(host)).toBe('1F3864')
  })

  it('clears the background so resolution falls back to the layout and master', () => {
    const host = createPlaygroundAssetHost()
    host.setSlideBackground({ fill: { color: { type: 'srgb', v: '1F3864' } } })

    const snapshot = host.setSlideBackground(null)

    expect(snapshot.status).toEqual({ kind: 'success', message: 'slide-background-updated' })
    expect(host.getSnapshot().engineState.document.slides.sld_playground).not.toHaveProperty('background')
  })

  it('undoes a background change through the shared history', () => {
    const host = createPlaygroundAssetHost()
    host.setSlideBackground({ fill: { color: { type: 'srgb', v: '1F3864' } } })

    host.undo()

    expect(backgroundOf(host)).not.toBe('1F3864')
  })

  it('reports a stable failure for a malformed colour instead of throwing', () => {
    const host = createPlaygroundAssetHost()

    const snapshot = host.setSlideBackground({ fill: { color: { type: 'nope', v: 'x' } } } as never)

    expect(snapshot.status).toEqual({ kind: 'error', message: 'slide-background-failed' })
  })
})

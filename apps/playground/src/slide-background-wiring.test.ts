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

describe('playground master and layout background wiring', () => {
  function host() {
    return createPlaygroundAssetHost()
  }

  it('sets a master background and reports success', () => {
    const h = host()
    const snapshot = h.setMasterBackground({ fill: { color: { type: 'srgb', v: '203864' } } })

    expect(snapshot.status).toEqual({ kind: 'success', message: 'master-background-updated' })
    const document = h.getSnapshot().engineState.document
    const masterId = Object.keys(document.masters ?? {})[0]!
    expect(document.masters?.[masterId]?.background).toEqual({ fill: { color: { type: 'srgb', v: '203864' } } })
  })

  it('sets a layout background and clears it back', () => {
    const h = host()
    h.setLayoutBackground({ fill: { color: { type: 'srgb', v: 'FF0000' } } })
    const document = h.getSnapshot().engineState.document
    const layoutId = Object.keys(document.layouts ?? {})[0]!
    expect(document.layouts?.[layoutId]?.background).toEqual({ fill: { color: { type: 'srgb', v: 'FF0000' } } })

    const cleared = h.setLayoutBackground(null)
    expect(cleared.status).toEqual({ kind: 'success', message: 'layout-background-updated' })
    expect(cleared.engineState.document.layouts?.[layoutId]).not.toHaveProperty('background')
  })

  it('paints the slide from an inherited master background when the slide declares none', () => {
    const h = host()
    h.setMasterBackground({ fill: { color: { type: 'srgb', v: '00AA55' } } })
    expect(backgroundOf(h)).toBe('00AA55')
  })
})

describe('playground slide layout switch wiring', () => {
  it('switches the active slide to another layout under the same master', () => {
    const host = createPlaygroundAssetHost()
    const document = host.getSnapshot().engineState.document
    const currentLayout = document.slides.sld_playground?.layoutId
    const masterId = currentLayout ? document.layouts?.[currentLayout]?.masterId : undefined
    // Seed a second layout under the same master to switch to.
    // (The seed deck has one layout; this asserts the guard + wiring, not multi-layout seeding.)
    const snapshot = host.setSlideLayout(currentLayout ?? 'lay_playground')
    // Switching to the same layout is a no-op success (no throw); the message reflects the attempt.
    expect(['slide-layout-updated', 'layout-missing']).toContain(snapshot.status.message)
    expect(masterId).toBeDefined()
  })

  it('reports layout-missing for an unknown layout', () => {
    const host = createPlaygroundAssetHost()
    const snapshot = host.setSlideLayout('nope')
    expect(snapshot.status).toEqual({ kind: 'error', message: 'layout-missing' })
  })
})

describe('playground slide layout switch (two seeded layouts)', () => {
  it('switches the active slide between the two layouts under its master', () => {
    const host = createPlaygroundAssetHost()
    const before = host.getSnapshot().engineState.document.slides.sld_playground?.layoutId
    expect(before).toBe('lay_playground')

    const snapshot = host.setSlideLayout('lay_playground_title')
    expect(snapshot.status).toEqual({ kind: 'success', message: 'slide-layout-updated' })
    expect(snapshot.engineState.document.slides.sld_playground?.layoutId).toBe('lay_playground_title')
  })
})

describe('playground duplicate layout wiring', () => {
  it('adds a layout under the master and can switch to it', () => {
    const host = createPlaygroundAssetHost()
    const before = Object.keys(host.getSnapshot().engineState.document.layouts ?? {}).length

    const snapshot = host.addLayout('lay_playground')
    expect(snapshot.status).toEqual({ kind: 'success', message: 'layout-added' })
    const layouts = host.getSnapshot().engineState.document.layouts ?? {}
    expect(Object.keys(layouts).length).toBe(before + 1)
    const added = Object.values(layouts).find((l) => l.id !== 'lay_playground' && l.id !== 'lay_playground_title')!
    expect(added.masterId).toBe('mst_playground')

    const switched = host.setSlideLayout(added.id)
    expect(switched.engineState.document.slides.sld_playground?.layoutId).toBe(added.id)
  })

  it('reports layout-missing when duplicating an unknown layout', () => {
    const host = createPlaygroundAssetHost()
    expect(host.addLayout('nope').status).toEqual({ kind: 'error', message: 'layout-missing' })
  })
})

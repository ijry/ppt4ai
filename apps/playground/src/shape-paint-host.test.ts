// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { documentToSceneGraph } from '@ppt4ai/render'
import { createPlaygroundAssetHost } from './asset-host'

function selectShape(host: ReturnType<typeof createPlaygroundAssetHost>): string {
  const document = host.getSnapshot().engineState.document
  const shapeId = Object.values(document.elements).find((element) => element.kind === 'shape')?.id
  if (!shapeId) throw new Error('seed document has no shape')
  host.selectElement(shapeId)
  return shapeId
}

function shapeOf(host: ReturnType<typeof createPlaygroundAssetHost>, elementId: string) {
  const element = host.getSnapshot().engineState.document.elements[elementId]
  if (element?.kind !== 'shape') throw new Error('element is not a shape')
  return element
}

describe('playground shape paint editing', () => {
  it('sets the fill of the selected shape', () => {
    const host = createPlaygroundAssetHost()
    const shapeId = selectShape(host)

    const snapshot = host.setSelectedFill({ color: { type: 'srgb', v: 'FF0000' } })

    expect(snapshot.status).toEqual({ kind: 'success', message: 'fill-updated' })
    expect(shapeOf(host, shapeId).fill).toEqual({ color: { type: 'srgb', v: 'FF0000' } })
  })

  /** The scene is what the canvas paints, so the assertion is on the resolved colour. */
  it('changes the colour the scene resolves', () => {
    const host = createPlaygroundAssetHost()
    const shapeId = selectShape(host)

    host.setSelectedFill({ color: { type: 'srgb', v: 'FF0000' } })

    const node = documentToSceneGraph(host.getSnapshot().engineState.document).nodes.find((entry) => entry.id === shapeId)
    if (node?.kind !== 'shape') throw new Error('scene did not build a shape node')
    expect(node.resolvedFillColor).toEqual({ rgb: 'FF0000', alpha: 100000 })
  })

  it('sets the outline colour, width and dash', () => {
    const host = createPlaygroundAssetHost()
    const shapeId = selectShape(host)

    host.setSelectedStroke({ color: { type: 'srgb', v: '00FF00' } })
    host.setSelectedStrokeWidth(76200)
    const snapshot = host.setSelectedStrokeStyle('dot')

    expect(snapshot.status).toEqual({ kind: 'success', message: 'stroke-style-updated' })
    const shape = shapeOf(host, shapeId)
    expect(shape.stroke).toEqual({ color: { type: 'srgb', v: '00FF00' } })
    expect(shape.strokeWidth).toBe(76200)
    expect(shape.strokeStyle).toBe('dot')
  })

  it('clears each property with null', () => {
    const host = createPlaygroundAssetHost()
    const shapeId = selectShape(host)
    host.setSelectedStrokeWidth(76200)

    host.setSelectedFill(null)
    host.setSelectedStrokeWidth(null)

    const shape = shapeOf(host, shapeId)
    expect(shape).not.toHaveProperty('fill')
    expect(shape).not.toHaveProperty('strokeWidth')
  })

  /** The commands are element-scoped, so the host refuses rather than editing an arbitrary element. */
  it('reports a missing target with no selection', () => {
    const host = createPlaygroundAssetHost()

    const snapshot = host.setSelectedFill({ color: { type: 'srgb', v: 'FF0000' } })

    expect(snapshot.status).toEqual({ kind: 'error', message: 'paint-target-required' })
  })

  it('reports a missing target for a kind that cannot carry paint', () => {
    const host = createPlaygroundAssetHost()
    const document = host.getSnapshot().engineState.document
    const tableId = Object.values(document.elements).find((element) => element.kind === 'table')?.id
    if (!tableId) throw new Error('seed document has no table')
    host.selectElement(tableId)

    expect(host.setSelectedFill(null).status).toEqual({ kind: 'error', message: 'paint-target-required' })
  })

  it('reports a failure without throwing when the command rejects the value', () => {
    const host = createPlaygroundAssetHost()
    selectShape(host)

    const snapshot = host.setSelectedStrokeWidth(-1)

    expect(snapshot.status).toEqual({ kind: 'error', message: 'stroke-width-failed' })
  })

  it('undoes a paint edit', () => {
    const host = createPlaygroundAssetHost()
    const shapeId = selectShape(host)
    const before = shapeOf(host, shapeId).fill

    host.setSelectedFill({ color: { type: 'srgb', v: 'FF0000' } })
    host.undo()

    expect(shapeOf(host, shapeId).fill).toEqual(before)
  })
})

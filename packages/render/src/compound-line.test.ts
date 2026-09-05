import { describe, expect, it } from 'vitest'
import type { Ppt4aiDocument, Theme } from '@ppt4ai/model'
import { documentToSceneGraph } from './index'

function documentWith(
  shape: { strokeCompound?: string; strokeAlign?: string; styleRef?: unknown },
  theme?: Theme,
): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_compound',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_shape'], layoutId: 'lyt_1' } },
    slideOrder: ['sld_1'],
    elements: {
      el_shape: {
        id: 'el_shape',
        kind: 'shape',
        preset: 'rect',
        bounds: { x: 0, y: 0, w: 1000000, h: 1000000 },
        stroke: { color: { type: 'srgb', v: '203864' } },
        ...shape,
      },
    },
    layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1' } },
    masters: { mst_1: { id: 'mst_1', themeId: 'theme-1' } },
    themes: { 'theme-1': theme ?? { id: 'theme-1', colors: {} } },
  } as unknown as Ppt4aiDocument
}

function shapeNode(document: Ppt4aiDocument) {
  const node = documentToSceneGraph(document).nodes[0]
  if (node?.kind !== 'shape') throw new Error('fixture did not build a shape node')
  return node
}

function themeWith(compound?: string, align?: string): Theme {
  return {
    id: 'theme-1',
    colors: {},
    formatScheme: {
      lineStyles: [{
        color: { type: 'srgb', v: 'FF0000' },
        ...(compound ? { compound } : {}),
        ...(align ? { align } : {}),
      }],
    },
  } as unknown as Theme
}

describe('compound line in the scene graph', () => {
  it('carries the element values onto the node', () => {
    const node = shapeNode(documentWith({ strokeCompound: 'dbl', strokeAlign: 'in' }))

    expect(node.strokeCompound).toBe('dbl')
    expect(node.strokeAlign).toBe('in')
  })

  it('falls back to the theme line style entry', () => {
    const node = shapeNode(documentWith({ styleRef: { line: { idx: 1 } } }, themeWith('tri', 'ctr')))

    expect(node.strokeCompound).toBe('tri')
    expect(node.strokeAlign).toBe('ctr')
  })

  /** Property by property, the order cap and join already follow. */
  it('prefers the element value over the theme entry', () => {
    const node = shapeNode(documentWith(
      { strokeCompound: 'thickThin', styleRef: { line: { idx: 1 } } },
      themeWith('dbl', 'in'),
    ))

    expect(node.strokeCompound).toBe('thickThin')
    expect(node.strokeAlign).toBe('in')
  })

  it('leaves both absent when neither side declares one', () => {
    const node = shapeNode(documentWith({}))

    expect(node.strokeCompound).toBeUndefined()
    expect(node.strokeAlign).toBeUndefined()
  })
})

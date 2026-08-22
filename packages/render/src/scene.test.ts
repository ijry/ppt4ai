import { describe, expect, it } from 'vitest'
import { documentToSceneGraph } from './index'
import type { Ppt4aiDocument } from '@ppt4ai/model'

const minimalDocument: Ppt4aiDocument = {
  format: 'ppt4ai',
  version: 1,
  id: 'dck_1',
  page: { w: 12192000, h: 6858000 },
      slides: { sld_1: { id: 'sld_1', elementIds: ['el_shape', 'el_table'], layoutId: 'lyt_1' } },
  elements: {
    el_shape: {
      id: 'el_shape',
      kind: 'shape',
      preset: 'rect',
      bounds: { x: 1000000, y: 1000000, w: 4000000, h: 2000000 },
      fill: { color: { type: 'srgb', v: '4472C4' } },
    },
  },
  slideOrder: ['sld_1'],
}

describe('documentToSceneGraph', () => {
  it('converts a minimal slide into deterministic ordered nodes', () => {
    expect(documentToSceneGraph(minimalDocument)).toMatchInlineSnapshot(`
      {
        "nodes": [
          {
            "bounds": {
              "h": 2000000,
              "w": 4000000,
              "x": 1000000,
              "y": 1000000,
            },
            "fill": {
              "color": {
                "type": "srgb",
                "v": "4472C4",
              },
            },
            "id": "el_shape",
            "kind": "shape",
            "path": [
              {
                "type": "move",
                "x": 1000000,
                "y": 1000000,
              },
              {
                "type": "line",
                "x": 5000000,
                "y": 1000000,
              },
              {
                "type": "line",
                "x": 5000000,
                "y": 3000000,
              },
              {
                "type": "line",
                "x": 1000000,
                "y": 3000000,
              },
              {
                "type": "close",
              },
            ],
          },
        ],
        "page": {
          "h": 6858000,
          "w": 12192000,
        },
        "slideId": "sld_1",
      }
    `)
  })

  it('preserves slide element order and converts text nodes', () => {
    const slideDocument: Ppt4aiDocument = {
      ...minimalDocument,
      slides: {
        sld_1: { id: 'sld_1', elementIds: ['el_text', 'el_shape'] },
      },
      elements: {
        ...minimalDocument.elements,
        el_text: {
          id: 'el_text',
          kind: 'text',
          bounds: { x: 2000000, y: 4000000, w: 5000000, h: 800000 },
          text: 'Hello',
        },
      },
    }

    const nodes = documentToSceneGraph(slideDocument).nodes
    expect(nodes).toHaveLength(2)
    expect(nodes[0]).toMatchObject({
      id: 'el_text',
      kind: 'text',
      bounds: { x: 2000000, y: 4000000, w: 5000000, h: 800000 },
      text: 'Hello',
      layout: {
        bounds: { x: 2000000, y: 4000000, w: 5000000, h: 800000 },
        fontScale: 100000,
        overflow: false,
      },
    })
    expect(nodes[0]?.kind === 'text' ? nodes[0].layout.lines[0]?.runs[0]?.text : undefined).toBe('Hello')
    expect(nodes[1]).toEqual(expect.objectContaining({ id: 'el_shape', kind: 'shape' }))
  })

  it('resolves layout and master defaults before creating scene nodes', () => {
    const inheritedDocument: Ppt4aiDocument = {
      ...minimalDocument,
      slides: {
        sld_1: { id: 'sld_1', elementIds: ['el_text'], layoutId: 'lyt_1' },
      },
      elements: {
        el_text: {
          id: 'el_text',
          kind: 'text',
          bounds: { x: 2000000, y: 4000000, w: 5000000, h: 800000 },
          text: 'Inherited',
          placeholder: 'title',
        },
      },
      layouts: {
        lyt_1: {
          id: 'lyt_1',
          masterId: 'mst_1',
          defaults: { title: { fill: { color: { type: 'srgb', v: 'FFFFFF' } } } },
        },
      },
      masters: {
        mst_1: {
          id: 'mst_1',
          defaults: { title: { fill: { color: { type: 'srgb', v: '000000' } } } },
        },
      },
    }

    expect(documentToSceneGraph(inheritedDocument).nodes[0]).toMatchObject({
      id: 'el_text',
      kind: 'text',
      bounds: { x: 2000000, y: 4000000, w: 5000000, h: 800000 },
      text: 'Inherited',
      fill: { color: { type: 'srgb', v: 'FFFFFF' } },
      layout: { lines: [{ runs: [{ text: 'Inherited' }] }] },
    })
  })

  it('expands flat groups in child order', () => {
    const groupedDocument: Ppt4aiDocument = {
      ...minimalDocument,
      slides: { sld_1: { id: 'sld_1', elementIds: ['grp_1'] } },
      elements: {
        ...minimalDocument.elements,
        el_text: {
          id: 'el_text',
          kind: 'text',
          bounds: { x: 6000000, y: 1000000, w: 1000000, h: 1000000 },
          text: 'Grouped',
        },
        grp_1: {
          id: 'grp_1',
          kind: 'group',
          bounds: { x: 1000000, y: 1000000, w: 6000000, h: 2000000 },
          childIds: ['el_shape', 'el_text'],
        },
      },
    }

    expect(documentToSceneGraph(groupedDocument).nodes.map((node) => node.id)).toEqual(['el_shape', 'el_text'])
  })

  it('converts tables into clone-safe layout nodes in slide order', () => {
    const tableDocument: Ppt4aiDocument = {
      ...minimalDocument,
      slides: { sld_1: { id: 'sld_1', elementIds: ['el_shape', 'el_table'], layoutId: 'lyt_1' } },
      elements: {
        ...minimalDocument.elements,
        el_table: {
          id: 'el_table',
          kind: 'table',
          bounds: { x: 2000000, y: 2000000, w: 3000000, h: 2000000 },
          columns: [1000000, 2000000],
          rows: [
            { height: 500000, cells: [{ column: 0, colSpan: 2, body: { paragraphs: [{ runs: [{ text: 'Header' }] }] } }] },
            { height: 1500000, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'Left' }] }] } }, { column: 1, body: { paragraphs: [{ runs: [{ text: 'Right' }] }] } }] },
          ],
          placeholder: 'table',
        },
      },
      layouts: {
        lyt_1: {
          id: 'lyt_1',
          masterId: 'mst_1',
          defaults: { table: { fill: { color: { type: 'srgb', v: 'FFFFFF' } }, stroke: { color: { type: 'srgb', v: '000000' } } } },
        },
      },
      masters: { mst_1: { id: 'mst_1' } },
    }

    const graph = documentToSceneGraph(tableDocument)
    expect(graph.nodes.map((node) => node.kind)).toEqual(['shape', 'table'])
    expect(graph.nodes[1]).toMatchObject({
      id: 'el_table',
      kind: 'table',
      bounds: { x: 2000000, y: 2000000, w: 3000000, h: 2000000 },
      fill: { color: { type: 'srgb', v: 'FFFFFF' } },
      stroke: { color: { type: 'srgb', v: '000000' } },
      layout: {
        columns: [1000000, 2000000],
        rows: [500000, 1500000],
        cells: [
          { row: 0, column: 0, rowSpan: 1, colSpan: 2, bounds: { x: 2000000, y: 2000000, w: 3000000, h: 500000 } },
          { row: 1, column: 0, rowSpan: 1, colSpan: 1, bounds: { x: 2000000, y: 2500000, w: 1000000, h: 1500000 } },
          { row: 1, column: 1, rowSpan: 1, colSpan: 1, bounds: { x: 3000000, y: 2500000, w: 2000000, h: 1500000 } },
        ],
      },
    })
    expect(structuredClone(graph)).toEqual(graph)
  })
})

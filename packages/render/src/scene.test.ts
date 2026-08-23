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
            "resolvedFillColor": {
              "alpha": 100000,
              "rgb": "4472C4",
            },
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

  it('converts image elements into clone-safe nodes with asset metadata', () => {
    const imageDocument: Ppt4aiDocument = {
      ...minimalDocument,
      slides: { sld_1: { id: 'sld_1', elementIds: ['el_shape', 'el_image'] } },
      elements: {
        ...minimalDocument.elements,
        el_image: {
          id: 'el_image',
          kind: 'image',
          bounds: { x: 2500000, y: 1800000, w: 5000000, h: 3000000 },
          assetId: 'asset_photo_png',
          transform: { rotation: 5400000, flipH: true },
          sourceCrop: { left: 1000, right: 3000 },
          maskPreset: 'ellipse',
          effects: [{ type: 'alphaModFix', amount: 50000 }, { type: 'grayscl' }],
        },
      },
      assets: {
        asset_photo_png: {
          id: 'asset_photo_png',
          mimeType: 'image/png',
          pixelWidth: 1600,
          pixelHeight: 900,
          originalFilename: 'photo.png',
        },
      },
    }

    const graph = documentToSceneGraph(imageDocument)
    expect(graph.nodes.map((node) => node.id)).toEqual(['el_shape', 'el_image'])
    expect(graph.nodes[1]).toEqual({
      id: 'el_image',
      kind: 'image',
      bounds: { x: 2500000, y: 1800000, w: 5000000, h: 3000000 },
      assetId: 'asset_photo_png',
      transform: { rotation: 5400000, flipH: true },
      sourceCrop: { left: 1000, right: 3000 },
      maskPreset: 'ellipse',
      effects: [{ type: 'alphaModFix', amount: 50000 }, { type: 'grayscl' }],
      metadata: {
        id: 'asset_photo_png',
        mimeType: 'image/png',
        pixelWidth: 1600,
        pixelHeight: 900,
        originalFilename: 'photo.png',
      },
    })
    const sourceImage = imageDocument.elements.el_image
    if (sourceImage?.kind !== 'image') throw new Error('expected image fixture')
    sourceImage.transform!.rotation = 0
    sourceImage.sourceCrop!.left = 99999
    sourceImage.effects![0] = { type: 'grayscl' }
    expect(graph.nodes[1]).toMatchObject({
      transform: { rotation: 5400000, flipH: true },
      sourceCrop: { left: 1000, right: 3000 },
      effects: [{ type: 'alphaModFix', amount: 50000 }, { type: 'grayscl' }],
    })
    expect(structuredClone(graph)).toEqual(graph)
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

  it('resolves theme colors and table text defaults in the effective slide context', () => {
    const themedDocument: Ppt4aiDocument = {
      ...minimalDocument,
      slides: {
        sld_1: {
          id: 'sld_1',
          elementIds: ['el_shape', 'el_text', 'el_table'],
          layoutId: 'lyt_1',
          colorMapOverride: { accent1: 'accent1' },
        },
      },
      elements: {
        el_shape: {
          id: 'el_shape',
          kind: 'shape',
          preset: 'rect',
          bounds: { x: 1000000, y: 1000000, w: 2000000, h: 1000000 },
          fill: { color: { type: 'scheme', v: 'accent1' } },
          stroke: { color: { type: 'scheme', v: 'tx1' } },
        },
        el_text: {
          id: 'el_text',
          kind: 'text',
          bounds: { x: 1000000, y: 2500000, w: 3000000, h: 800000 },
          body: {
            paragraphs: [{ runs: [{ text: 'Theme', marks: { color: { color: { type: 'scheme', v: 'accent1' } } } }] }],
          },
          fill: { color: { type: 'scheme', v: 'accent1' } },
          stroke: { color: { type: 'scheme', v: 'tx1' } },
        },
        el_table: {
          id: 'el_table',
          kind: 'table',
          bounds: { x: 5000000, y: 1000000, w: 4000000, h: 1000000 },
          columns: [4000000],
          rows: [{
            height: 1000000,
            cells: [{
              column: 0,
              body: {
                paragraphs: [{
                  runs: [
                    { text: 'Default' },
                    { text: 'Explicit', marks: { color: { color: { type: 'scheme', v: 'accent2' } }, bold: false } },
                  ],
                }],
              },
            }],
          }],
          style: { styleId: 'style-1', firstRow: true },
        },
      },
      tableStyles: {
        'style-1': {
          id: 'style-1',
          regions: {
            firstRow: {
              fill: { color: { type: 'scheme', v: 'accent1' } },
              borders: { left: { color: { type: 'scheme', v: 'accent1' }, width: 12700, style: 'solid' } },
              text: { color: { type: 'scheme', v: 'tx1' }, bold: true },
            },
          },
        },
      },
      layouts: {
        lyt_1: { id: 'lyt_1', masterId: 'mst_1', colorMapOverride: { accent1: 'accent3' } },
      },
      masters: {
        mst_1: { id: 'mst_1', themeId: 'theme-1', colorMap: { accent1: 'accent2' } },
      },
      themes: {
        'theme-1': {
          id: 'theme-1',
          colors: {
            dk1: { type: 'srgb', v: '202020' },
            accent1: { type: 'srgb', v: '336699' },
            accent2: { type: 'srgb', v: 'AA5500' },
            accent3: { type: 'srgb', v: '00AA55' },
          },
        },
      },
    }

    const sourceDocument = structuredClone(themedDocument)
    const graph = documentToSceneGraph(themedDocument)
    expect(graph.nodes[0]).toMatchObject({
      kind: 'shape',
      fill: { color: { type: 'scheme', v: 'accent1' } },
      stroke: { color: { type: 'scheme', v: 'tx1' } },
      resolvedFillColor: { rgb: '336699', alpha: 100000 },
      resolvedStrokeColor: { rgb: '202020', alpha: 100000 },
    })
    expect(graph.nodes[1]).toMatchObject({
      kind: 'text',
      resolvedFillColor: { rgb: '336699', alpha: 100000 },
      resolvedStrokeColor: { rgb: '202020', alpha: 100000 },
      layout: { lines: [{ runs: [{ text: 'Theme', resolvedColor: { rgb: '336699', alpha: 100000 } }] }] },
    })
    expect(graph.nodes[2]).toMatchObject({
      kind: 'table',
      layout: {
        cells: [{
          resolvedStyle: {
            fill: { color: { type: 'scheme', v: 'accent1' } },
            text: { color: { type: 'scheme', v: 'tx1' }, bold: true },
          },
          resolvedFillColor: { rgb: '336699', alpha: 100000 },
          resolvedBorderColors: { left: { rgb: '336699', alpha: 100000 } },
          resolvedTextStyle: { color: { rgb: '202020', alpha: 100000 }, bold: true },
          textLayout: {
            lines: [{
              runs: [
                {
                  text: 'Default',
                  marks: { color: { color: { type: 'scheme', v: 'tx1' } }, bold: true },
                  resolvedColor: { rgb: '202020', alpha: 100000 },
                },
                {
                  text: 'Explicit',
                  marks: { color: { color: { type: 'scheme', v: 'accent2' } }, bold: false },
                  resolvedColor: { rgb: 'AA5500', alpha: 100000 },
                },
              ],
            }],
          },
        }],
      },
    })
    expect(structuredClone(graph)).toEqual(graph)
    expect(themedDocument).toEqual(sourceDocument)
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

  it('emits clone-safe metadata for nested groups without changing flat paint order', () => {
    const nestedGroupDocument: Ppt4aiDocument = {
      ...minimalDocument,
      slides: { sld_1: { id: 'sld_1', elementIds: ['grp_outer', 'el_sibling'] } },
      elements: {
        ...minimalDocument.elements,
        el_text: {
          id: 'el_text',
          kind: 'text',
          bounds: { x: 6000000, y: 1000000, w: 1000000, h: 1000000 },
          text: 'Grouped',
        },
        el_sibling: {
          id: 'el_sibling',
          kind: 'shape',
          preset: 'ellipse',
          bounds: { x: 9000000, y: 1000000, w: 1000000, h: 1000000 },
        },
        grp_inner: {
          id: 'grp_inner',
          kind: 'group',
          bounds: { x: 500000, y: 500000, w: 7000000, h: 2500000 },
          childIds: ['el_shape', 'el_text'],
        },
        grp_outer: {
          id: 'grp_outer',
          kind: 'group',
          bounds: { x: 500000, y: 500000, w: 7000000, h: 2500000 },
          childIds: ['grp_inner'],
        },
      },
    }

    const graph = documentToSceneGraph(nestedGroupDocument)
    expect(graph.nodes.map((node) => node.id)).toEqual(['el_shape', 'el_text', 'el_sibling'])
    expect(graph.groups).toEqual([
      {
        id: 'grp_outer',
        bounds: { x: 500000, y: 500000, w: 7000000, h: 2500000 },
        childIds: ['grp_inner'],
        ancestorIds: [],
        paintOrder: 1,
      },
      {
        id: 'grp_inner',
        bounds: { x: 500000, y: 500000, w: 7000000, h: 2500000 },
        childIds: ['el_shape', 'el_text'],
        ancestorIds: ['grp_outer'],
        paintOrder: 1,
      },
    ])
    expect(structuredClone(graph)).toEqual(graph)
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
            { height: 1500000, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'Left' }] }] } }, { column: 1, body: { paragraphs: [{ runs: [] }] }, fill: { color: { type: 'srgb', v: '00FF00' } } }] },
          ],
          style: { styleId: 'style-1', firstRow: true, firstColumn: true, bandRow: true },
          placeholder: 'table',
        },
      },
      tableStyles: {
        'style-1': {
          id: 'style-1',
          regions: {
            wholeTable: { fill: { color: { type: 'srgb', v: 'FFFFFF' } }, borders: { bottom: { color: { type: 'srgb', v: '111111' }, width: 1000, style: 'solid' } } },
            band1H: { fill: { color: { type: 'srgb', v: 'EEEEEE' } } },
            firstRow: { fill: { color: { type: 'srgb', v: 'FF0000' } } },
            firstCol: { borders: { left: { color: { type: 'srgb', v: '0000FF' }, width: 2000, style: 'dash' } } },
          },
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
    const tableNode = graph.nodes[1]
    if (!tableNode || tableNode.kind !== 'table') throw new Error('expected table node')
    expect(tableNode.layout.cells[0]).toMatchObject({
      body: { paragraphs: [{ runs: [{ text: 'Header' }] }] },
      resolvedStyle: {
        fill: { color: { type: 'srgb', v: 'FF0000' } },
        borders: {
          bottom: { color: { type: 'srgb', v: '111111' }, width: 1000, style: 'solid' },
          left: { color: { type: 'srgb', v: '0000FF' }, width: 2000, style: 'dash' },
        },
      },
      textLayout: {
        bounds: { x: 2000000, y: 2000000, w: 3000000, h: 500000 },
        lines: [{ runs: [{ text: 'Header' }] }],
        overflow: false,
      },
    })
    expect(tableNode.layout.cells[1]?.textLayout).toMatchObject({
      bounds: { x: 2000000, y: 2500000, w: 1000000, h: 1500000 },
      lines: [{ runs: [{ text: 'Left' }] }],
    })
    expect(tableNode.layout.cells[1]?.resolvedStyle).toEqual({
      fill: { color: { type: 'srgb', v: 'EEEEEE' } },
      borders: {
        bottom: { color: { type: 'srgb', v: '111111' }, width: 1000, style: 'solid' },
        left: { color: { type: 'srgb', v: '0000FF' }, width: 2000, style: 'dash' },
      },
    })
    expect(tableNode.layout.cells[2]?.resolvedStyle).toEqual({
      fill: { color: { type: 'srgb', v: '00FF00' } },
      borders: { bottom: { color: { type: 'srgb', v: '111111' }, width: 1000, style: 'solid' } },
    })
    expect(tableNode.layout.cells[2]?.textLayout).toMatchObject({
      bounds: { x: 3000000, y: 2500000, w: 2000000, h: 1500000 },
      lines: [{ runs: [] }],
      overflow: false,
    })
    expect(structuredClone(graph)).toEqual(graph)
  })
})

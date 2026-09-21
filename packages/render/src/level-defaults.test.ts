import { describe, expect, it } from 'vitest'
import type { Ppt4aiDocument, SlideLayout, SlideMaster, TextMarks } from '@ppt4ai/model'
import { documentToSceneGraph } from './scenegraph'

describe('level defaults rendering', () => {
  it('merges master textStyles defaults into placeholder text', () => {
    const document: Ppt4aiDocument = {
      format: 'ppt4ai',
      version: 1,
      id: 'doc_1',
      page: { w: 10, h: 7.5 },
      slideOrder: ['sld_1'],
      slides: { sld_1: { id: 'sld_1', elementIds: ['el_1'], layoutId: 'lyt_1', masterId: 'mst_1' } },
      elements: {
        el_1: {
          id: 'el_1',
          kind: 'text',
          bounds: { x: 1, y: 1, w: 8, h: 2 },
          placeholder: 'title',
          body: {
            paragraphs: [
              {
                runs: [{ text: 'Title text' }],
              },
            ],
          },
        },
      },
      layouts: {
        lyt_1: {
          id: 'lyt_1',
          masterId: 'mst_1',
        } satisfies SlideLayout,
      },
      masters: {
        mst_1: {
          id: 'mst_1',
          textStyles: {
            title: [
              {
                level: 0,
                marks: { fontSize: 44, bold: true, fontFamily: 'Aptos' },
              },
            ],
          },
        } satisfies SlideMaster,
      },
    }

    const scene = documentToSceneGraph(document)
    expect(scene.nodes).toHaveLength(1)
    const textNode = scene.nodes[0]
    if (!textNode || textNode.kind !== 'text') throw new Error('expected text node')

    // The run should inherit fontSize: 44 and bold: true from master textStyles
    const run = textNode.layout.lines[0]?.runs[0]
    expect(run).toBeDefined()
    expect(run?.marks?.fontSize).toBe(44)
    expect(run?.marks?.bold).toBe(true)
    expect(run?.marks?.fontFamily).toBe('Aptos')
  })

  it('merges layout lstStyle defaults into placeholder text', () => {
    const document: Ppt4aiDocument = {
      format: 'ppt4ai',
      version: 1,
      id: 'doc_1',
      page: { w: 10, h: 7.5 },
      slideOrder: ['sld_1'],
      slides: { sld_1: { id: 'sld_1', elementIds: ['el_1'], layoutId: 'lyt_1', masterId: 'mst_1' } },
      elements: {
        el_1: {
          id: 'el_1',
          kind: 'text',
          bounds: { x: 1, y: 1, w: 8, h: 2 },
          placeholder: 'body',
          body: {
            paragraphs: [
              {
                runs: [{ text: 'Body text' }],
              },
            ],
          },
        },
      },
      layouts: {
        lyt_1: {
          id: 'lyt_1',
          masterId: 'mst_1',
          defaults: {
            body: {
              listStyle: [
                {
                  level: 0,
                  marks: { fontSize: 28, italic: true },
                },
              ],
            },
          },
        } satisfies SlideLayout,
      },
      masters: {
        mst_1: {
          id: 'mst_1',
        } satisfies SlideMaster,
      },
    }

    const scene = documentToSceneGraph(document)
    const textNode = scene.nodes[0]
    if (!textNode || textNode.kind !== 'text') throw new Error('expected text node')

    const run = textNode.layout.lines[0]?.runs[0]
    expect(run?.marks?.fontSize).toBe(28)
    expect(run?.marks?.italic).toBe(true)
  })

  it('does not merge defaults into non-placeholder text', () => {
    const document: Ppt4aiDocument = {
      format: 'ppt4ai',
      version: 1,
      id: 'doc_1',
      page: { w: 10, h: 7.5 },
      slideOrder: ['sld_1'],
      slides: { sld_1: { id: 'sld_1', elementIds: ['el_1'], layoutId: 'lyt_1', masterId: 'mst_1' } },
      elements: {
        el_1: {
          id: 'el_1',
          kind: 'text',
          bounds: { x: 1, y: 1, w: 8, h: 2 },
          body: {
            paragraphs: [
              {
                runs: [{ text: 'Regular text', marks: { fontSize: 16 } }],
              },
            ],
          },
        },
      },
      layouts: {
        lyt_1: {
          id: 'lyt_1',
          masterId: 'mst_1',
        } satisfies SlideLayout,
      },
      masters: {
        mst_1: {
          id: 'mst_1',
          textStyles: {
            title: [{ level: 0, marks: { fontSize: 44 } }],
          },
        } satisfies SlideMaster,
      },
    }

    const scene = documentToSceneGraph(document)
    const textNode = scene.nodes[0]
    if (!textNode || textNode.kind !== 'text') throw new Error('expected text node')

    const run = textNode.layout.lines[0]?.runs[0]
    // Should keep the explicit fontSize: 16, not inherit master defaults
    expect(run?.marks?.fontSize).toBe(16)
  })

  it('run marks override level defaults', () => {
    const document: Ppt4aiDocument = {
      format: 'ppt4ai',
      version: 1,
      id: 'doc_1',
      page: { w: 10, h: 7.5 },
      slideOrder: ['sld_1'],
      slides: { sld_1: { id: 'sld_1', elementIds: ['el_1'], layoutId: 'lyt_1', masterId: 'mst_1' } },
      elements: {
        el_1: {
          id: 'el_1',
          kind: 'text',
          bounds: { x: 1, y: 1, w: 8, h: 2 },
          placeholder: 'title',
          body: {
            paragraphs: [
              {
                runs: [{ text: 'Title text', marks: { fontSize: 32 } }],
              },
            ],
          },
        },
      },
      layouts: {
        lyt_1: {
          id: 'lyt_1',
          masterId: 'mst_1',
        } satisfies SlideLayout,
      },
      masters: {
        mst_1: {
          id: 'mst_1',
          textStyles: {
            title: [{ level: 0, marks: { fontSize: 44, bold: true } }],
          },
        } satisfies SlideMaster,
      },
    }

    const scene = documentToSceneGraph(document)
    const textNode = scene.nodes[0]
    if (!textNode || textNode.kind !== 'text') throw new Error('expected text node')

    const run = textNode.layout.lines[0]?.runs[0]
    // Explicit fontSize: 32 overrides master default of 44
    expect(run?.marks?.fontSize).toBe(32)
    // But still inherits bold: true
    expect(run?.marks?.bold).toBe(true)
  })
})

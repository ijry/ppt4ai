import { describe, expect, it } from 'vitest'
import {
  clonePartDependencies,
  collectPartClosure,
} from './dependency-graph.js'
import type { ZipEntry } from './zip.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function entry(name: string, value: string | number[]): ZipEntry {
  return { name, data: typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value) }
}

function dependencyEntries(): Map<string, ZipEntry> {
  const values = [
    entry('ppt/slides/slide1.xml', '<p:sld/>'),
    entry('ppt/slides/_rels/slide1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.test/a?x=1&amp;y=2" TargetMode="External"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>'),
    entry('ppt/slideLayouts/slideLayout1.xml', '<p:sldLayout/>'),
    entry('ppt/notesSlides/notesSlide1.xml', '<p:notes/>'),
    entry('ppt/notesSlides/_rels/notesSlide1.xml.rels', '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments/comment1.xml"/></Relationships>'),
    entry('ppt/comments/comment1.xml', '<p:commentList/>'),
    entry('ppt/media/image1.png', [1, 2, 3, 4]),
  ]
  return new Map(values.map((value) => [value.name, value] as const))
}

describe('pptx dependency graph', () => {
  it('collects a part, its relationship sidecar, and recursive internal targets', () => {
    const closure = collectPartClosure(dependencyEntries(), 'ppt/slides/slide1.xml')

    expect([...closure].sort()).toEqual([
      'ppt/comments/comment1.xml',
      'ppt/media/image1.png',
      'ppt/notesSlides/_rels/notesSlide1.xml.rels',
      'ppt/notesSlides/notesSlide1.xml',
      'ppt/slideLayouts/slideLayout1.xml',
      'ppt/slides/_rels/slide1.xml.rels',
      'ppt/slides/slide1.xml',
    ])
  })

  it('clones non-global dependencies and rewrites only mapped internal targets', () => {
    const entries = dependencyEntries()
    const result = clonePartDependencies(
      entries,
      'ppt/slides/slide1.xml',
      'ppt/slides/slide3.xml',
      new Set(entries.keys()),
    )

    expect(result.pathMap.get('ppt/slides/slide1.xml')).toBe('ppt/slides/slide3.xml')
    expect(result.pathMap.get('ppt/slideLayouts/slideLayout1.xml')).toBe('ppt/slideLayouts/slideLayout1.xml')
    expect(result.pathMap.get('ppt/notesSlides/notesSlide1.xml')).toBe('ppt/notesSlides/notesSlide2.xml')
    expect(result.pathMap.get('ppt/comments/comment1.xml')).toBe('ppt/comments/comment2.xml')
    expect(result.pathMap.get('ppt/media/image1.png')).toBe('ppt/media/image2.png')
    expect(result.entries.map((value) => value.name)).toEqual([
      'ppt/slides/slide3.xml',
      'ppt/slides/_rels/slide3.xml.rels',
      'ppt/notesSlides/notesSlide2.xml',
      'ppt/notesSlides/_rels/notesSlide2.xml.rels',
      'ppt/comments/comment2.xml',
      'ppt/media/image2.png',
    ])

    const relationships = decoder.decode(result.entries[1]!.data)
    expect(relationships).toContain('Id="rId1"')
    expect(relationships).toContain('Target="../slideLayouts/slideLayout1.xml"')
    expect((relationships.match(/Target="\.\.\/notesSlides\/notesSlide2\.xml"/g) ?? [])).toHaveLength(2)
    expect(relationships).toContain('Target="../media/image2.png"')
    expect(relationships).toContain('Target="https://example.test/a?x=1&amp;y=2" TargetMode="External"')

    const nestedRelationships = decoder.decode(result.entries[3]!.data)
    expect(nestedRelationships).toContain('Target="../comments/comment2.xml"')
    expect(result.entries.find((value) => value.name === 'ppt/media/image2.png')?.data).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('terminates on dependency cycles and produces deterministic paths', () => {
    const values = [
      entry('ppt/slides/slide1.xml', '<p:sld/>'),
      entry('ppt/slides/_rels/slide1.xml.rels', '<Relationships><Relationship Id="rId1" Type="x/chart" Target="../charts/chart1.xml"/></Relationships>'),
      entry('ppt/charts/chart1.xml', '<c:chart/>'),
      entry('ppt/charts/_rels/chart1.xml.rels', '<Relationships><Relationship Id="rId1" Type="x/chart" Target="chart2.xml"/></Relationships>'),
      entry('ppt/charts/chart2.xml', '<c:chart/>'),
      entry('ppt/charts/_rels/chart2.xml.rels', '<Relationships><Relationship Id="rId1" Type="x/chart" Target="chart1.xml"/></Relationships>'),
    ]
    const entries = new Map(values.map((value) => [value.name, value] as const))

    const first = clonePartDependencies(entries, 'ppt/slides/slide1.xml', 'ppt/slides/slide4.xml', new Set(entries.keys()))
    const second = clonePartDependencies(entries, 'ppt/slides/slide1.xml', 'ppt/slides/slide4.xml', new Set(entries.keys()))

    expect(first.pathMap.get('ppt/charts/chart1.xml')).toBe('ppt/charts/chart3.xml')
    expect(first.pathMap.get('ppt/charts/chart2.xml')).toBe('ppt/charts/chart4.xml')
    expect(first.entries.map((value) => value.name)).toEqual([
      'ppt/slides/slide4.xml',
      'ppt/slides/_rels/slide4.xml.rels',
      'ppt/charts/chart3.xml',
      'ppt/charts/_rels/chart3.xml.rels',
      'ppt/charts/chart4.xml',
      'ppt/charts/_rels/chart4.xml.rels',
    ])
    expect(first.entries).toEqual(second.entries)
    expect(decoder.decode(first.entries[3]!.data)).toContain('Target="chart4.xml"')
    expect(decoder.decode(first.entries[5]!.data)).toContain('Target="chart3.xml"')
  })
})

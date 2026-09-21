import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

function slideWith(body: string): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Broken"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr>'
    + `<p:txBody>${body}</p:txBody></p:sp>`
    + '</p:spTree></p:cSld></p:sld>'
}

async function textElement(body: string) {
  const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': slideWith(body) }))
  const element = document.elements.el_1
  if (element?.kind !== 'text') throw new Error('fixture did not import as text')
  return element
}

function runTexts(element: Awaited<ReturnType<typeof textElement>>): string[] {
  return element.body?.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')) ?? []
}

describe('line breaks keep their position on import', () => {
  it('puts the break between the two runs it separates', async () => {
    const element = await textElement('<a:bodyPr/><a:p>'
      + '<a:r><a:t>Above</a:t></a:r><a:br/><a:r><a:t>Below</a:t></a:r>'
      + '</a:p>')

    expect(runTexts(element)).toEqual(['Above\nBelow'])
    expect(element.text).toBe('Above\nBelow')
  })

  it('keeps a leading break', async () => {
    const element = await textElement('<a:bodyPr/><a:p><a:br/><a:r><a:t>After</a:t></a:r></a:p>')

    expect(runTexts(element)).toEqual(['\nAfter'])
  })

  it('keeps a trailing break', async () => {
    const element = await textElement('<a:bodyPr/><a:p><a:r><a:t>Before</a:t></a:r><a:br/></a:p>')

    expect(runTexts(element)).toEqual(['Before\n'])
  })

  it('keeps two consecutive breaks as two newlines', async () => {
    const element = await textElement('<a:bodyPr/><a:p><a:r><a:t>A</a:t></a:r><a:br/><a:br/><a:r><a:t>B</a:t></a:r></a:p>')

    expect(runTexts(element)).toEqual(['A\n\nB'])
  })

  it('breaks separate paragraphs with a newline of their own', async () => {
    const element = await textElement('<a:bodyPr/>'
      + '<a:p><a:r><a:t>One</a:t></a:r><a:br/><a:r><a:t>Two</a:t></a:r></a:p>'
      + '<a:p><a:r><a:t>Three</a:t></a:r></a:p>')

    expect(runTexts(element)).toEqual(['One\nTwo', 'Three'])
    expect(element.text).toBe('One\nTwo\nThree')
  })

  it('keeps the flat text field splittable back into paragraphs', async () => {
    const element = await textElement('<a:bodyPr/>'
      + '<a:p><a:r><a:t>One</a:t></a:r></a:p>'
      + '<a:p><a:r><a:t>Two</a:t></a:r></a:p>')

    // normalizeTextElement (in @ppt4ai/text) rebuilds paragraphs by splitting this field on
    // newlines. The old counting version ran them together, so four paragraphs came back as one.
    expect(element.text?.split('\n')).toEqual(['One', 'Two'])
  })

  it('starts a new run after a break when the marks differ', async () => {
    const element = await textElement('<a:bodyPr/><a:p>'
      + '<a:r><a:rPr b="1"/><a:t>Bold</a:t></a:r><a:br/><a:r><a:rPr i="1"/><a:t>Italic</a:t></a:r>'
      + '</a:p>')

    // The newline joins the first run, which is where the source break sat.
    expect(element.body?.paragraphs[0]?.runs).toEqual([
      { text: 'Bold\n', marks: { bold: true } },
      { text: 'Italic', marks: { italic: true } },
    ])
  })

  it('carries a break in an unformatted paragraph without inventing marks', async () => {
    const element = await textElement('<a:bodyPr/><a:p><a:br/></a:p>')

    expect(element.body?.paragraphs[0]?.runs).toEqual([{ text: '\n' }])
  })
})

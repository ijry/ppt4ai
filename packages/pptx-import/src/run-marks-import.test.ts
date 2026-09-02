import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

function slideWith(body: string): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Formatted"/><p:nvPr/></p:nvSpPr>'
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

async function firstRun(runProperties: string) {
  const element = await textElement(`<a:bodyPr/><a:p><a:r>${runProperties}<a:t>Styled</a:t></a:r></a:p>`)
  return element.body?.paragraphs[0]?.runs[0]
}

describe('run marks on import', () => {
  it('reads every supported mark from one rPr', async () => {
    const run = await firstRun('<a:rPr sz="3200" b="1" i="1" u="sng" baseline="30000">'
      + '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:latin typeface="Georgia"/></a:rPr>')

    expect(run).toEqual({
      text: 'Styled',
      marks: {
        fontFamily: 'Georgia',
        fontSize: 32,
        bold: true,
        italic: true,
        underline: 'single',
        color: { color: { type: 'srgb', v: 'FF0000' } },
        baseline: 30000,
      },
    })
  })

  it('converts sz from hundredths of a point to points', async () => {
    expect(await firstRun('<a:rPr sz="1050"/>')).toMatchObject({ marks: { fontSize: 10.5 } })
  })

  it('records an explicit b="0" as false rather than omitting it', async () => {
    const run = await firstRun('<a:rPr b="0" i="0"/>')

    // Matches parseStyleText: an explicit zero can override an inherited bold.
    expect(run).toMatchObject({ marks: { bold: false, italic: false } })
  })

  it('keeps u="none" distinct from an absent u, because the model has a none value', async () => {
    expect(await firstRun('<a:rPr u="none"/>')).toMatchObject({ marks: { underline: 'none' } })
    expect(await firstRun('<a:rPr sz="1800"/>')).not.toHaveProperty('marks.underline')
  })

  it('reads a scheme colour as a scheme reference', async () => {
    const run = await firstRun('<a:rPr><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:rPr>')

    expect(run).toMatchObject({ marks: { color: { color: { type: 'scheme', v: 'accent2' } } } })
  })

  it('keeps colour transforms on a run colour', async () => {
    const run = await firstRun('<a:rPr><a:solidFill><a:srgbClr val="112233"><a:alpha val="50000"/></a:srgbClr></a:solidFill></a:rPr>')

    expect(run).toMatchObject({ marks: { color: { color: { transforms: [{ type: 'alpha', value: 50000 }] } } } })
  })

  it('omits marks entirely when rPr carries nothing we model', async () => {
    expect(await firstRun('<a:rPr dirty="0"/>')).toEqual({ text: 'Styled' })
  })

  it('omits marks when there is no rPr at all', async () => {
    expect(await firstRun('')).toEqual({ text: 'Styled' })
  })

  it('gives each run its own marks', async () => {
    const element = await textElement('<a:bodyPr/><a:p>'
      + '<a:r><a:rPr b="1"/><a:t>Bold</a:t></a:r>'
      + '<a:r><a:rPr i="1"/><a:t> then italic</a:t></a:r>'
      + '</a:p>')

    expect(element.body?.paragraphs[0]?.runs).toEqual([
      { text: 'Bold', marks: { bold: true } },
      { text: ' then italic', marks: { italic: true } },
    ])
  })

  it('rejects a non-positive font size rather than storing it, since the model requires positive', async () => {
    expect(await firstRun('<a:rPr sz="0"/>')).toEqual({ text: 'Styled' })
  })

  it('leaves the legacy text field as plain characters', async () => {
    const element = await textElement('<a:bodyPr/><a:p><a:r><a:rPr b="1"/><a:t>Styled</a:t></a:r></a:p>')

    expect(element.text).toBe('Styled')
  })
})

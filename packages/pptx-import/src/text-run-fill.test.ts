import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

function runWith(runProps: string): string {
  return files['ppt/slides/slide1.xml'].replace(
    '<a:r><a:t>Imported title</a:t></a:r>',
    `<a:r><a:rPr>${runProps}</a:rPr><a:t>Imported title</a:t></a:r>`,
  )
}

async function firstRunMarks(runProps: string) {
  const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': runWith(runProps) }))
  const element = Object.values(document.elements).find((candidate) => candidate.kind === 'text')
  if (element?.kind !== 'text') throw new Error('fixture did not import a text element')
  return element.body?.paragraphs[0]?.runs[0]?.marks
}

describe('text run non-solid fill on import', () => {
  /** Before this a run colour used the solid-only parser, so a gradient text fill was dropped. */
  it('reads a gradient run fill, keeping the first stop as the flat colour', async () => {
    const marks = await firstRunMarks(
      '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="4472C4"/></a:gs>'
      + '<a:gs pos="100000"><a:srgbClr val="203864"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill>',
    )
    expect(marks?.color?.color).toEqual({ type: 'srgb', v: '4472C4' })
    expect(marks?.color?.gradient?.stops).toHaveLength(2)
  })

  it('reads a pattern run fill, mirroring the foreground into the colour', async () => {
    const marks = await firstRunMarks(
      '<a:pattFill prst="ltHorz"><a:fgClr><a:srgbClr val="FF0000"/></a:fgClr>'
      + '<a:bgClr><a:srgbClr val="00FF00"/></a:bgClr></a:pattFill>',
    )
    expect(marks?.color?.color).toEqual({ type: 'srgb', v: 'FF0000' })
    expect(marks?.color?.pattern?.preset).toBe('ltHorz')
  })

  it('still reads a plain solid run fill', async () => {
    const marks = await firstRunMarks('<a:solidFill><a:srgbClr val="1F3864"/></a:solidFill>')
    expect(marks?.color).toEqual({ color: { type: 'srgb', v: '1F3864' } })
  })
})

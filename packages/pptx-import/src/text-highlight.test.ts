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

describe('text highlight on import', () => {
  it('reads a:highlight as the run highlight colour', async () => {
    const marks = await firstRunMarks('<a:highlight><a:srgbClr val="FFFF00"/></a:highlight>')
    expect(marks?.highlight).toEqual({ type: 'srgb', v: 'FFFF00' })
  })

  it('reads highlight alongside the fill colour without confusing the two', async () => {
    const marks = await firstRunMarks('<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:highlight><a:srgbClr val="00FF00"/></a:highlight>')
    expect(marks?.color).toEqual({ color: { type: 'srgb', v: 'FF0000' } })
    expect(marks?.highlight).toEqual({ type: 'srgb', v: '00FF00' })
  })

  it('leaves highlight unset when the run has none', async () => {
    const marks = await firstRunMarks('<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>')
    expect(marks?.highlight).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

function slideWith(runProperties: string, text = 'Hello 你好'): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Mixed"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="6000000" cy="1000000"/></a:xfrm></p:spPr>'
    + `<p:txBody><a:bodyPr/><a:p><a:r>${runProperties}<a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
    + '</p:spTree></p:cSld></p:sld>'
}

async function firstRunMarks(runProperties: string) {
  const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': slideWith(runProperties) }))
  const element = document.elements.el_1
  if (element?.kind !== 'text') throw new Error('fixture did not import as text')
  return element.body?.paragraphs[0]?.runs[0]?.marks
}

describe('run script fonts on import', () => {
  it('reads the latin, east asian and complex typefaces into their own fields', async () => {
    const marks = await firstRunMarks('<a:rPr sz="2400">'
      + '<a:latin typeface="Calibri"/><a:ea typeface="宋体"/><a:cs typeface="Arial"/></a:rPr>')

    expect(marks).toEqual({ fontFamily: 'Calibri', fontFamilyEa: '宋体', fontFamilyCs: 'Arial', fontSize: 24 })
  })

  it('omits a script font the run does not declare', async () => {
    const marks = await firstRunMarks('<a:rPr><a:latin typeface="Georgia"/></a:rPr>')

    expect(marks).toEqual({ fontFamily: 'Georgia' })
  })

  /** `typeface=""` is how a source says "no override", the same rule `a:latin` already followed. */
  it('treats an empty typeface as absent', async () => {
    const marks = await firstRunMarks('<a:rPr><a:latin typeface="Georgia"/><a:ea typeface=""/><a:cs typeface="  "/></a:rPr>')

    expect(marks).toEqual({ fontFamily: 'Georgia' })
  })

  it('keeps a per-script theme reference verbatim for the renderer to resolve', async () => {
    const marks = await firstRunMarks('<a:rPr><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/></a:rPr>')

    expect(marks).toEqual({ fontFamily: '+mn-lt', fontFamilyEa: '+mn-ea' })
  })

  it('reads a run that only declares an east asian typeface', async () => {
    const marks = await firstRunMarks('<a:rPr><a:ea typeface="微软雅黑"/></a:rPr>')

    expect(marks).toEqual({ fontFamilyEa: '微软雅黑' })
  })
})

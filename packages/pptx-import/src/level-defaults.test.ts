import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

const master = '<p:sldMaster xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
  + '<p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="500000" y="300000"/><a:ext cx="8000000" cy="1200000"/></a:xfrm></p:spPr>'
  + '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>'
  + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Body"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="500000" y="1800000"/><a:ext cx="8000000" cy="3000000"/></a:xfrm></p:spPr>'
  + '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>'
  + '</p:spTree></p:cSld>'
  + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
  + '<p:txStyles>'
  + '<p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400" b="1">'
  + '<a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>'
  + '<p:bodyStyle>'
  + '<a:lvl1pPr marL="342900" indent="-342900"><a:buChar char="•"/><a:defRPr sz="2800"><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>'
  + '<a:lvl2pPr marL="742950" indent="-285750"><a:defRPr sz="2400" i="1"/></a:lvl2pPr>'
  + '</p:bodyStyle>'
  + '<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle>'
  + '</p:txStyles></p:sldMaster>'

const layout = '<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
  + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
  + '<p:spPr/><p:txBody><a:bodyPr/>'
  + '<a:lstStyle><a:lvl1pPr><a:defRPr sz="3600" u="sng"/></a:lvl1pPr></a:lstStyle>'
  + '<a:p><a:endParaRPr/></a:p></p:txBody></p:sp>'
  + '</p:spTree></p:cSld></p:sldLayout>'

const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
  + '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="500000" y="300000"/><a:ext cx="8000000" cy="1200000"/></a:xfrm></p:spPr>'
  + '<p:txBody><a:bodyPr/><a:p><a:r><a:t>Real title</a:t></a:r></a:p></p:txBody></p:sp>'
  + '<p:sp><p:nvSpPr><p:cNvPr id="4" name="Body"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="500000" y="1800000"/><a:ext cx="8000000" cy="3000000"/></a:xfrm></p:spPr>'
  + '<p:txBody><a:bodyPr/>'
  + '<a:p><a:r><a:t>Level one</a:t></a:r></a:p>'
  + '<a:p><a:pPr lvl="1"/><a:r><a:t>Level two</a:t></a:r></a:p>'
  + '<a:p><a:pPr><a:defRPr sz="1200"/></a:pPr><a:r><a:t>Paragraph default</a:t></a:r></a:p>'
  + '</p:txBody></p:sp>'
  + '</p:spTree></p:cSld></p:sld>'

describe('level defaults', () => {
  it('parse defRPr, lstStyle, and txStyles from master/layout/paragraph', async () => {
    const document = await importPptx(createStoredZip({
      ...files,
      'ppt/slideMasters/slideMaster1.xml': master,
      'ppt/slideLayouts/slideLayout1.xml': layout,
      'ppt/slides/slide1.xml': slide,
    }))

    // Master textStyles
    expect(document.masters?.mst_1).toBeDefined()
    const masterData = document.masters!.mst_1!
    expect(masterData.textStyles).toBeDefined()
    const masterTextStyles = masterData.textStyles!
    const { title, body, other } = masterTextStyles
    expect(title).toHaveLength(1)
    expect(title![0]).toMatchObject({ level: 0, attrs: { align: 'center' }, marks: { fontSize: 44, bold: true, fontFamily: '+mj-lt' } })
    expect(body).toHaveLength(2)
    expect(body![0]).toMatchObject({ level: 0, marks: { fontSize: 28, fontFamily: '+mn-lt' } })
    expect(body![1]).toMatchObject({ level: 1, marks: { fontSize: 24, italic: true } })
    expect(other).toHaveLength(1)
    expect(other![0]).toMatchObject({ level: 0, marks: { fontSize: 18 } })

    // Layout lstStyle
    const layoutTitleDefaults = document.layouts!.lyt_1!.defaults!.title
    expect(layoutTitleDefaults).toBeDefined()
    expect(layoutTitleDefaults?.listStyle).toHaveLength(1)
    expect(layoutTitleDefaults?.listStyle![0]).toMatchObject({ level: 0, marks: { fontSize: 36, underline: 'sng' } })

    // Paragraph defRPr
    const bodyElement = document.elements.el_2
    expect(bodyElement?.kind).toBe('text')
    if (bodyElement?.kind !== 'text') throw new Error('body element missing')
    expect(bodyElement.body).toBeDefined()
    const bodyTextBody = bodyElement.body!
    expect(bodyTextBody.paragraphs[2]).toBeDefined()
    expect(bodyTextBody.paragraphs[2]!.attrs?.defaultMarks).toMatchObject({ fontSize: 12 })
  })
})

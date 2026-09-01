import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

const groupedSlide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
  + '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="10" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
  + '<p:grpSpPr><a:xfrm rot="2700000"><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:grpSpPr>'
  + '<p:sp><p:nvSpPr><p:cNvPr id="11" name="Inner"/><p:nvPr/></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="1200000" y="1200000"/><a:ext cx="1000000" cy="500000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>'
  + '<p:txBody><a:p><a:r><a:t>Inside</a:t></a:r></a:p></p:txBody></p:sp>'
  + '</p:grpSp>'
  + '<p:sp><p:nvSpPr><p:cNvPr id="12" name="Outside"/><p:nvPr/></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="6000000" y="1000000"/><a:ext cx="1000000" cy="500000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>'
  + '<p:txBody><a:p><a:r><a:t>Outside</a:t></a:r></a:p></p:txBody></p:sp>'
  + '</p:spTree></p:cSld></p:sld>'

const groupedFiles = { ...files, 'ppt/slides/slide1.xml': groupedSlide }

describe('group import', () => {
  it('imports p:grpSp as a group element rather than flattening it away', async () => {
    const document = await importPptx(createStoredZip(groupedFiles))
    const slide = document.slides.sld_1!
    const group = Object.values(document.elements).find((element) => element.kind === 'group')

    expect(group).toBeDefined()
    if (group?.kind !== 'group') throw new Error('expected a group element')
    expect(group.id).toMatch(/^grp_/)
    expect(group.bounds).toEqual({ x: 1000000, y: 1000000, w: 4000000, h: 2000000 })
    expect(group.rotation).toBe(2700000)
    expect(slide.elementIds).toContain(group.id)
  })

  it('keeps leaf ids on the el_ sequence so the writeback scan stays aligned', async () => {
    const document = await importPptx(createStoredZip(groupedFiles))
    const leafIds = Object.values(document.elements).filter((element) => element.kind !== 'group').map((element) => element.id)

    expect(leafIds).toEqual(['el_1', 'el_2'])
  })

  it('lists the group before its children so scene flattening cascades rotation', async () => {
    const document = await importPptx(createStoredZip(groupedFiles))
    const slide = document.slides.sld_1!
    const group = Object.values(document.elements).find((element) => element.kind === 'group')
    if (group?.kind !== 'group') throw new Error('expected a group element')

    const groupIndex = slide.elementIds.indexOf(group.id)
    for (const childId of group.childIds) {
      const childIndex = slide.elementIds.indexOf(childId)
      if (childIndex >= 0) expect(groupIndex).toBeLessThan(childIndex)
    }
  })

  it('names children so a group child is distinguishable from a top-level leaf', async () => {
    const document = await importPptx(createStoredZip(groupedFiles))
    const group = Object.values(document.elements).find((element) => element.kind === 'group')
    if (group?.kind !== 'group') throw new Error('expected a group element')

    expect(group.childIds).toEqual(['el_1'])
    expect(document.elements.el_1).toMatchObject({ kind: 'text', bounds: { x: 1200000, y: 1200000, w: 1000000, h: 500000 } })
    expect(document.elements.el_2).toMatchObject({ kind: 'text', bounds: { x: 6000000, y: 1000000, w: 1000000, h: 500000 } })
  })

  it('omits rotation when the group has no rot attribute', async () => {
    const withoutRotation = { ...groupedFiles, 'ppt/slides/slide1.xml': groupedSlide.replace(' rot="2700000"', '') }
    const document = await importPptx(createStoredZip(withoutRotation))
    const group = Object.values(document.elements).find((element) => element.kind === 'group')
    if (group?.kind !== 'group') throw new Error('expected a group element')

    expect(group.rotation).toBeUndefined()
  })

  it('drops a group whose grpSpPr carries no usable bounds, keeping its children as leaves', async () => {
    const boundless = groupedSlide.replace('<a:xfrm rot="2700000"><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm>', '')
    const document = await importPptx(createStoredZip({ ...groupedFiles, 'ppt/slides/slide1.xml': boundless }))
    const slide = document.slides.sld_1!

    expect(Object.values(document.elements).some((element) => element.kind === 'group')).toBe(false)
    expect(slide.elementIds).toEqual(['el_1', 'el_2'])
  })
})

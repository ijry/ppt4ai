import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

function slideWith(geometry: string): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Adjusted"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `${geometry}</p:spPr>`
    + '</p:sp></p:spTree></p:cSld></p:sld>'
}

async function adjustValuesOf(geometry: string) {
  const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': slideWith(geometry) }))
  const shape = document.elements.el_1
  if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
  return shape.adjustValues
}

describe('preset geometry adjust values on import', () => {
  /** Before this the list was dropped, so a sourceless export reset the shape to its default form. */
  it('reads a single adjust value', async () => {
    expect(await adjustValuesOf('<a:prstGeom prst="roundRect">'
      + '<a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom>'))
      .toEqual([{ name: 'adj', formula: 'val 25000' }])
  })

  it('keeps several in the order the file states them', async () => {
    expect(await adjustValuesOf('<a:prstGeom prst="round2DiagRect">'
      + '<a:avLst><a:gd name="adj1" fmla="val 16667"/><a:gd name="adj2" fmla="val 0"/></a:avLst></a:prstGeom>'))
      .toEqual([{ name: 'adj1', formula: 'val 16667' }, { name: 'adj2', formula: 'val 0' }])
  })

  /**
   * `a:gd/@fmla` is the same attribute type `a:gdLst` uses, and its language has forms other than
   * `val N`. Storing the string keeps them; parsing to a number would drop them silently.
   */
  it('keeps a formula that is not the val form', async () => {
    expect(await adjustValuesOf('<a:prstGeom prst="chevron">'
      + '<a:avLst><a:gd name="adj" fmla="pin 0 adj 50000"/></a:avLst></a:prstGeom>'))
      .toEqual([{ name: 'adj', formula: 'pin 0 adj 50000' }])
  })

  it('drops an entry missing either attribute', async () => {
    expect(await adjustValuesOf('<a:prstGeom prst="roundRect"><a:avLst>'
      + '<a:gd name="adj"/><a:gd fmla="val 1"/><a:gd name="adj2" fmla="val 2"/>'
      + '</a:avLst></a:prstGeom>')).toEqual([{ name: 'adj2', formula: 'val 2' }])
  })

  /** An empty list and no list mean the same thing — use the defaults — so both leave the field absent. */
  it('leaves the field absent for an empty or missing list', async () => {
    expect(await adjustValuesOf('<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>')).toBeUndefined()
    expect(await adjustValuesOf('<a:prstGeom prst="roundRect"/>')).toBeUndefined()
  })

  /** `a:custGeom` has its own `a:avLst` and `a:gdLst`; those belong with the formula language. */
  it('does not read the list a custom geometry carries', async () => {
    expect(await adjustValuesOf('<a:custGeom><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst>'
      + '<a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo>'
      + '<a:lnTo><a:pt x="100" y="100"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>'))
      .toBeUndefined()
  })
})

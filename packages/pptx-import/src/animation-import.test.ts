import { validateDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

const shape = (id: number) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:nvPr/></p:nvSpPr>`
  + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
  + '<a:prstGeom prst="rect"/></p:spPr></p:sp>'

const slideWithTiming = (timing: string) =>
  '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
  + shape(2) + shape(3)
  + '</p:spTree></p:cSld>'
  + timing
  + '</p:sld>'

const importSlide = (timing: string) =>
  importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': slideWithTiming(timing) }))

const MAIN_SEQ =
  '<p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst>'
  + '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" nodeType="mainSeq"><p:childTnLst>'
  + '<p:par><p:cTn id="3" presetID="10" presetClass="entrance" presetSubtype="0" nodeType="clickEffect">'
  + '<p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>'
  + '<p:childTnLst><p:anim><p:cBhvr><p:cTn id="4" dur="500"/><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cBhvr></p:anim></p:childTnLst>'
  + '</p:cTn></p:par>'
  + '<p:par><p:cTn id="5" presetID="10" presetClass="exit" nodeType="withEffect">'
  + '<p:stCondLst><p:cond delay="0"/></p:stCondLst>'
  + '<p:childTnLst><p:anim><p:cBhvr><p:cTn id="6" dur="300"/><p:tgtEl><p:spTgt spid="3"/></p:tgtEl></p:cBhvr></p:anim></p:childTnLst>'
  + '</p:cTn></p:par>'
  + '</p:childTnLst></p:cTn>'
  + '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
  + '</p:seq>'
  + '</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'

const INTERACTIVE =
  '<p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst>'
  + '<p:seq concurrent="1" nextAc="seek"><p:cTn id="7" nodeType="interactiveSeq"><p:childTnLst>'
  + '<p:par><p:cTn id="8" presetID="10" presetClass="entrance" nodeType="clickEffect">'
  + '<p:stCondLst><p:cond delay="0"/></p:stCondLst>'
  + '<p:childTnLst><p:anim><p:cBhvr><p:cTn id="9" dur="250"/><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cBhvr></p:anim></p:childTnLst>'
  + '</p:cTn></p:par>'
  + '</p:childTnLst></p:cTn>'
  + '<p:prevCondLst><p:cond evt="onClick" delay="0"><p:tgtEl><p:spTgt spid="3"/></p:tgtEl></p:cond></p:prevCondLst>'
  + '</p:seq>'
  + '</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'

describe('animation import', () => {
  it('parses a main sequence into ordered builds keyed by slide id', async () => {
    const document = await importSlide(MAIN_SEQ)
    const timeline = document.animations?.sld_1
    expect(timeline?.mainSeq).toHaveLength(2)
    expect(timeline!.mainSeq[0]).toMatchObject({ trigger: 'onClick' })
    expect(timeline!.mainSeq[0]!.items[0]).toMatchObject({ targetId: 'el_1', class: 'entrance', presetId: 10, presetSubtype: 0, duration: 500 })
    expect(timeline!.mainSeq[1]).toMatchObject({ trigger: 'withPrev' })
    expect(timeline!.mainSeq[1]!.items[0]).toMatchObject({ targetId: 'el_2', class: 'exit', presetId: 10, duration: 300 })
  })

  it('maps a known presetID to a stable name while keeping the id verbatim', async () => {
    const item = (await importSlide(MAIN_SEQ)).animations?.sld_1?.mainSeq[0]?.items[0]
    expect(item).toMatchObject({ preset: 'fade', presetId: 10 })
  })

  it('falls back to a placeholder name for an unmapped presetID', async () => {
    const item = (await importSlide(MAIN_SEQ.replace('presetID="10" presetClass="entrance"', 'presetID="777" presetClass="entrance"')))
      .animations?.sld_1?.mainSeq[0]?.items[0]
    expect(item).toMatchObject({ preset: 'preset777', presetId: 777 })
  })

  it('resolves an interactive sequence trigger shape to its element id', async () => {
    const document = await importSlide(INTERACTIVE)
    const timeline = document.animations?.sld_1
    expect(timeline?.interactiveSeq).toHaveLength(1)
    expect(timeline!.interactiveSeq![0]).toMatchObject({ triggerId: 'el_2' })
    expect(timeline!.interactiveSeq![0]!.items[0]).toMatchObject({ targetId: 'el_1', duration: 250 })
    expect(timeline!.mainSeq).toHaveLength(0)
  })

  it('produces a document that validates (targets reference real elements)', async () => {
    const document = await importSlide(MAIN_SEQ)
    expect(validateDocument(document)).toEqual({ valid: true })
  })

  it('drops a build whose target shape does not exist', async () => {
    const timing = MAIN_SEQ.replace('spid="2"', 'spid="99"').replace('spid="3"', 'spid="98"')
    const document = await importSlide(timing)
    expect(document.animations?.sld_1).toBeUndefined()
  })

  it('leaves animations unset on a slide with no timing', async () => {
    const document = await importSlide('')
    expect(document.animations).toBeUndefined()
  })
})

import type { SlideTimeline } from '@ppt4ai/model'
import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

// cNvPr id 7 -> el_1, id 8 -> el_2 (document order), matching the importer's positional numbering.
const shape = (id: number) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Box ${id}"/><p:nvPr/></p:nvSpPr>`
  + '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:sp>'

function packageWith(timing = ''): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + shape(7) + shape(8)
    + `</p:spTree></p:cSld>${timing}</p:sld>`
  const encode = (value: string) => new TextEncoder().encode(value)
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: encode(slide) },
  ])
}

const SOURCE_TIMING =
  '<p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst>'
  + '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" nodeType="mainSeq"><p:childTnLst>'
  + '<p:par><p:cTn id="3" presetID="1" presetClass="entr" nodeType="clickEffect">'
  + '<p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>'
  + '<p:childTnLst><p:anim><p:cBhvr><p:cTn id="4" dur="500"/><p:tgtEl><p:spTgt spid="7"/></p:tgtEl></p:cBhvr></p:anim></p:childTnLst>'
  + '</p:cTn></p:par>'
  + '</p:childTnLst></p:cTn></p:seq>'
  + '</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'

async function slideOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  return new TextDecoder().decode(entries.get('ppt/slides/slide1.xml')!)
}

describe('animation writeback', () => {
  it('emits p:timing after cSld, targeting the shape cNvPr id', async () => {
    const source = packageWith('')
    const document = await importPptx(source)
    document.animations = {
      sld_1: { mainSeq: [{ trigger: 'onClick', items: [{ targetId: 'el_1', class: 'entrance', preset: 'preset1', presetId: 1, duration: 500 }] }] },
    }
    const xml = await slideOf(await exportPptx(document, source))
    expect(xml).toContain('<p:timing>')
    expect(xml).toContain('spid="7"')
    // The model's friendly class name is written back as the OOXML token PowerPoint expects.
    expect(xml).toContain('presetClass="entr"')
    expect(xml.indexOf('</p:cSld>')).toBeLessThan(xml.indexOf('<p:timing>'))
  })

  it('round-trips a main sequence through export and re-import', async () => {
    const source = packageWith('')
    const document = await importPptx(source)
    const timeline: SlideTimeline = {
      mainSeq: [
        { trigger: 'onClick', items: [{ targetId: 'el_1', class: 'entrance', preset: 'appear', presetId: 1, duration: 500 }] },
        { trigger: 'withPrev', items: [{ targetId: 'el_2', class: 'exit', preset: 'fade', presetId: 10, duration: 300 }] },
      ],
    }
    document.animations = { sld_1: timeline }
    const reimported = await importPptx(await exportPptx(document, source))
    expect(reimported.animations?.sld_1).toEqual(timeline)
  })

  it('round-trips an interactive sequence, resolving the trigger shape', async () => {
    const source = packageWith('')
    const document = await importPptx(source)
    const timeline: SlideTimeline = {
      mainSeq: [],
      interactiveSeq: [{ trigger: 'onClick', triggerId: 'el_2', items: [{ targetId: 'el_1', class: 'entrance', preset: 'appear', presetId: 1, duration: 250 }] }],
    }
    document.animations = { sld_1: timeline }
    const reimported = await importPptx(await exportPptx(document, source))
    expect(reimported.animations?.sld_1).toEqual(timeline)
  })

  it('deletes the timing node when the model no longer has animations', async () => {
    const source = packageWith(SOURCE_TIMING)
    const document = await importPptx(source)
    expect(document.animations?.sld_1).toBeDefined()
    delete document.animations
    const xml = await slideOf(await exportPptx(document, source))
    expect(xml).not.toContain('<p:timing>')
  })

  it('stays byte-identical when the timeline is untouched', async () => {
    const source = packageWith(SOURCE_TIMING)
    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })
})

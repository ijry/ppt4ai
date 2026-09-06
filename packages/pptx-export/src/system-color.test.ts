import { importPptx } from '@ppt4ai/pptx-import'
import type { Color, ElementDefaults, Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx, exportPptx, rewriteMasterXml, rewriteThemeXml } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

/**
 * `a:sysClr/@val` is the colour a reader looks up; `@lastClr` is only the value it cached. The model kept
 * the hex and nothing else, so `serializeColorXml` wrote a hardcoded `windowText` for every system colour
 * — and since every default Office theme states `dk1`/`lt1` as `a:sysClr`, the light slot of any imported
 * deck came out naming the system's dark colour. Both export paths are pinned here.
 */

const base: Ppt4aiDocument = {
  format: 'ppt4ai',
  version: 1,
  id: 'dck_system',
  page: { w: 12192000, h: 6858000 },
  slides: { sld_1: { id: 'sld_1', elementIds: [] } },
  elements: {},
  slideOrder: ['sld_1'],
}

function documentWithTheme(lt1: Color): Ppt4aiDocument {
  return {
    ...base,
    themes: { theme_1: { id: 'theme_1', colors: { lt1 } } },
    masters: { mst_1: { id: 'mst_1', themeId: 'theme_1' } },
    layouts: { lay_1: { id: 'lay_1', masterId: 'mst_1' } },
    slides: { sld_1: { id: 'sld_1', elementIds: [], layoutId: 'lay_1' } },
  }
}

async function themeXml(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  const data = entries.get('ppt/theme/theme1.xml')
  if (!data) throw new Error('missing generated theme')
  return new TextDecoder().decode(data)
}

const themeSource = (slot: string): string =>
  `<a:theme xmlns:a="a"><a:themeElements><a:clrScheme name="Custom"><a:lt1>${slot}</a:lt1></a:clrScheme><a:fontScheme/></a:themeElements></a:theme>`

describe('a system colour keeps its name on the sourceless path', () => {
  it('writes the name the model carries', async () => {
    const xml = await themeXml(await createPptx(documentWithTheme({ type: 'system', v: 'FFFFFF', systemName: 'window' })))

    expect(xml).toContain('<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>')
  })

  /** A system colour with no name is not a meaningful input, so the old fallback stands rather than a guess. */
  it('falls back to windowText when the model has no name', async () => {
    const xml = await themeXml(await createPptx(documentWithTheme({ type: 'system', v: 'FFFFFF' })))

    expect(xml).toContain('<a:lt1><a:sysClr val="windowText" lastClr="FFFFFF"/></a:lt1>')
  })
})

describe('a system colour keeps its name on the source-package path', () => {
  it('writes a changed name and leaves the cached value alone', () => {
    const source = themeSource('<a:sysClr val="window" lastClr="FFFFFF"/>')

    const output = rewriteThemeXml(source, {
      id: 'theme_1',
      colors: { lt1: { type: 'system', v: 'FFFFFF', systemName: 'menu' } },
    })

    expect(output).toContain('<a:sysClr val="menu" lastClr="FFFFFF"/>')
  })

  it('leaves the source name alone when the model has none', () => {
    const source = themeSource("<a:sysClr val='window' lastClr='FFFFFF'/>")

    const output = rewriteThemeXml(source, {
      id: 'theme_1',
      colors: { lt1: { type: 'system', v: '112233' } },
    })

    expect(output).toContain("<a:sysClr val='window' lastClr='112233'/>")
  })

  it('writes nothing at all when the name and the value both match', () => {
    const source = themeSource("<a:sysClr val='window' lastClr='FFFFFF'/>")

    expect(rewriteThemeXml(source, {
      id: 'theme_1',
      colors: { lt1: { type: 'system', v: 'FFFFFF', systemName: 'window' } },
    })).toBe(source)
  })

  /** Changing only the name is a change: without the mirror reading `@val` it would be swallowed. */
  it('rewrites the slot when only the name differs', () => {
    const source = themeSource('<a:sysClr val="window" lastClr="FFFFFF"/>')

    const output = rewriteThemeXml(source, {
      id: 'theme_1',
      colors: { lt1: { type: 'system', v: 'FFFFFF', systemName: 'windowText' } },
    })

    expect(output).toContain('<a:sysClr val="windowText" lastClr="FFFFFF"/>')
  })

  it('carries the name through the placeholder writeback, which rebuilds the colour', () => {
    const master = '<p:sldMaster xmlns:p="p" xmlns:d="drawing"><p:cSld><p:spTree>'
      + '<p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
      + '<p:spPr><d:solidFill><d:srgbClr val="112233"/></d:solidFill></p:spPr></p:sp>'
      + '</p:spTree></p:cSld></p:sldMaster>'
    const defaults: Record<string, ElementDefaults> = {
      title: { fill: { color: { type: 'system', v: 'FFFFFF', systemName: 'window' } } },
    }

    const output = rewriteMasterXml(master, defaults, undefined, 'master_1')

    expect(output).toContain('<d:sysClr val="window" lastClr="FFFFFF"/>')
  })
})

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

/** The colour is single-quoted, a spelling the serializer never produces, so a needless rewrite shows. */
const shapeFill = "<a:solidFill><a:sysClr val='window' lastClr='FFFFFF'/></a:solidFill>"

function slidePackage(): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Systemic"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `<a:prstGeom prst="rect"/>${shapeFill}</p:spPr>`
    + '<p:txBody><a:bodyPr/><a:p><a:r><a:t>Systemic</a:t></a:r></a:p></p:txBody></p:sp>'
    + '</p:spTree></p:cSld></p:sld>'
  const encode = (value: string) => new TextEncoder().encode(value)
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: encode(slide) },
  ])
}

describe('a shape fill that states a system colour', () => {
  /**
   * The mirror has to read `@val` for this to hold: with the model carrying a name the mirror cannot see,
   * the fill compares as changed and the colour child is rewritten in the serializer's own spelling.
   */
  it('is left byte for byte when an unrelated edit rewrites the slide', async () => {
    const source = slidePackage()
    const document = await importPptx(source)
    const element = document.elements.el_1
    if (element?.kind !== 'text') throw new Error('fixture did not import as text')
    element.body = { paragraphs: [{ runs: [{ text: 'Edited' }] }] }

    const entries = new Map((await readZipEntries(await exportPptx(document, source))).map((entry) => [entry.name, entry.data]))
    const slide = new TextDecoder().decode(entries.get('ppt/slides/slide1.xml'))

    expect(slide).toContain(shapeFill)
    expect(slide).toContain('Edited')
  })
})

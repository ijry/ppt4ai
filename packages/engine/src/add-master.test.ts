import type { Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { EditorEngine } from './index'

function documentWith(): Ppt4aiDocument {
  return {
    format: 'ppt4ai', version: 1, id: 'dck_master', page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [], layoutId: 'lyt_a', masterId: 'mst_1' } },
    slideOrder: ['sld_1'],
    elements: {},
    layouts: { lyt_a: { id: 'lyt_a', masterId: 'mst_1' } },
    masters: { mst_1: { id: 'mst_1', themeId: 'thm_1', background: { fill: { color: { type: 'srgb', v: '1F3864' } } } } },
    themes: { thm_1: { id: 'thm_1', colors: { accent1: { type: 'srgb', v: '4472C4' } } } },
  }
}

describe('addMaster', () => {
  it('duplicates a master with one of its layouts and undoes both', () => {
    const engine = new EditorEngine(documentWith())
    engine.dispatch({ type: 'addMaster', sourceMasterId: 'mst_1', masterId: 'mst_copy' })

    const doc = engine.getState().document
    const master = doc.masters?.mst_copy
    expect(master?.themeId).toBe('thm_1')
    expect(master?.background).toEqual({ fill: { color: { type: 'srgb', v: '1F3864' } } })
    // A fresh layout belongs to the new master.
    const layout = Object.values(doc.layouts ?? {}).find((l) => l.masterId === 'mst_copy')
    expect(layout).toBeDefined()

    engine.dispatch({ type: 'undo' })
    expect(engine.getState().document.masters?.mst_copy).toBeUndefined()
    expect(Object.values(engine.getState().document.layouts ?? {}).some((l) => l.masterId === 'mst_copy')).toBe(false)
  })

  it('drops the source part path on the copied master and layout', () => {
    const doc = documentWith()
    doc.masters!.mst_1!.source = { partPath: 'ppt/slideMasters/slideMaster1.xml' }
    doc.layouts!.lyt_a!.source = { partPath: 'ppt/slideLayouts/slideLayout1.xml' }
    const engine = new EditorEngine(doc)
    engine.dispatch({ type: 'addMaster', sourceMasterId: 'mst_1', masterId: 'mst_copy' })
    const d = engine.getState().document
    expect(d.masters?.mst_copy?.source).toBeUndefined()
    expect(Object.values(d.layouts ?? {}).find((l) => l.masterId === 'mst_copy')?.source).toBeUndefined()
  })

  it('throws for a missing source master', () => {
    const engine = new EditorEngine(documentWith())
    expect(() => engine.dispatch({ type: 'addMaster', sourceMasterId: 'nope' })).toThrow(/master does not exist/)
  })

  it('throws when the master has no layout to copy', () => {
    const doc = documentWith()
    delete doc.layouts!.lyt_a
    doc.slides.sld_1!.layoutId = undefined as unknown as string
    delete (doc.slides.sld_1 as { layoutId?: string }).layoutId
    const engine = new EditorEngine(doc)
    expect(() => engine.dispatch({ type: 'addMaster', sourceMasterId: 'mst_1' })).toThrow(/no layout to copy/)
  })
})

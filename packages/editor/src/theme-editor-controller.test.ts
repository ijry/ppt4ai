import { describe, expect, it } from 'vitest'
import { EditorEngine } from '@ppt4ai/engine'
import { DEFAULT_THEME_COLORS, DEFAULT_THEME_FONTS, type Ppt4aiDocument } from '@ppt4ai/model'
import { createThemeEditorController } from './theme-editor-controller'

function documentWithTheme(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_theme',
    page: { w: 10000000, h: 6000000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [], layoutId: 'lay_1' } },
    layouts: { lay_1: { id: 'lay_1', masterId: 'mst_1' } },
    masters: { mst_1: { id: 'mst_1', themeId: 'thm_1' } },
    themes: { thm_1: { id: 'thm_1', colors: { accent1: { type: 'srgb', v: 'FF0000' }, accent2: null } } },
    elements: {},
    slideOrder: ['sld_1'],
  }
}

describe('createThemeEditorController', () => {
  it('resolves the active theme through the layout master chain', () => {
    const controller = createThemeEditorController({ engine: new EditorEngine(documentWithTheme()) })

    expect(controller.activeThemeId('sld_1')).toBe('thm_1')
  })

  it('prefers an explicit slide master over the layout master', () => {
    const document = documentWithTheme()
    document.masters!.mst_2 = { id: 'mst_2', themeId: 'thm_2' }
    document.themes!.thm_2 = { id: 'thm_2', colors: {} }
    document.slides.sld_1!.masterId = 'mst_2'
    const controller = createThemeEditorController({ engine: new EditorEngine(document) })

    expect(controller.activeThemeId('sld_1')).toBe('thm_2')
  })

  it('returns undefined and no slots when no theme is reachable', () => {
    const document = documentWithTheme()
    delete document.masters!.mst_1!.themeId
    const controller = createThemeEditorController({ engine: new EditorEngine(document) })

    expect(controller.activeThemeId('sld_1')).toBeUndefined()
    expect(controller.slots('sld_1')).toEqual([])
  })

  it('maps explicit, reset, and inherited slots to display models', () => {
    const controller = createThemeEditorController({ engine: new EditorEngine(documentWithTheme()) })
    const slots = controller.slots('sld_1')
    const bySlot = new Map(slots.map((entry) => [entry.slot, entry]))

    expect(slots).toHaveLength(12)
    expect(bySlot.get('accent1')).toMatchObject({ color: '#FF0000', isDefault: false, inherited: false, group: 'accent' })
    expect(bySlot.get('accent2')).toMatchObject({ color: `#${DEFAULT_THEME_COLORS.accent2.v}`, isDefault: true, inherited: false })
    expect(bySlot.get('dk1')).toMatchObject({ color: `#${DEFAULT_THEME_COLORS.dk1.v}`, isDefault: false, inherited: true, group: 'neutral' })
  })

  it('dispatches color edits and resets for the active theme', () => {
    const engine = new EditorEngine(documentWithTheme())
    const controller = createThemeEditorController({ engine, slideId: 'sld_1' })

    expect(controller.setColor('accent3', { type: 'srgb', v: '112233' }).document.themes?.thm_1?.colors.accent3).toEqual({ type: 'srgb', v: '112233' })
    expect(controller.resetColor('accent1').document.themes?.thm_1?.colors.accent1).toBeNull()
    expect(controller.getState().history.undoDepth).toBe(2)
  })

  it('dispatches font edits and resets for the active theme', () => {
    const engine = new EditorEngine(documentWithTheme())
    const controller = createThemeEditorController({ engine, slideId: 'sld_1' })

    expect(controller.setFont('major', 'latin', 'Cambria').document.themes?.thm_1?.fonts).toEqual({ major: { latin: 'Cambria' } })
    expect(controller.resetFont('minor', 'latin').document.themes?.thm_1?.fonts?.minor?.latin).toBeNull()
    expect(controller.getState().history.undoDepth).toBe(2)
  })

  it('maps explicit, reset, and inherited typefaces to display models', () => {
    const document = documentWithTheme()
    document.themes!.thm_1!.fonts = { major: { latin: 'Cambria', ea: null } }
    const controller = createThemeEditorController({ engine: new EditorEngine(document), slideId: 'sld_1' })
    const byRow = new Map(controller.fonts().map((row) => [`${row.slot}-${row.script}`, row]))

    expect(controller.fonts()).toHaveLength(6)
    expect(byRow.get('major-latin')).toMatchObject({ typeface: 'Cambria', isDefault: false, inherited: false })
    expect(byRow.get('major-ea')).toMatchObject({ isDefault: true, inherited: false })
    expect(byRow.get('minor-latin')).toMatchObject({ typeface: DEFAULT_THEME_FONTS.minor.latin, inherited: true })
  })

  it('returns no font rows when no theme is reachable', () => {
    const document = documentWithTheme()
    delete document.masters!.mst_1!.themeId
    const controller = createThemeEditorController({ engine: new EditorEngine(document), slideId: 'sld_1' })

    expect(controller.fonts()).toEqual([])
    expect(() => controller.setFont('major', 'latin', 'Cambria')).toThrow(/no active theme for slide: sld_1/)
  })

  it('throws when editing without a reachable theme', () => {
    const document = documentWithTheme()
    delete document.masters!.mst_1!.themeId
    const controller = createThemeEditorController({ engine: new EditorEngine(document), slideId: 'sld_1' })

    expect(() => controller.resetColor('accent1')).toThrow(/no active theme for slide: sld_1/)
  })

  it('requires a slide id from options or the call site', () => {
    const controller = createThemeEditorController({ engine: new EditorEngine(documentWithTheme()) })

    expect(() => controller.setColor('accent1', { type: 'srgb', v: '112233' })).toThrow(/slideId is required/)
  })
})

import type { EditorEngine, EngineState } from '@ppt4ai/engine'
import { DEFAULT_THEME_COLORS, type Color, type Ppt4aiDocument, type ThemeColorSlot, type ThemeFontScript, type ThemeFontSlot } from '@ppt4ai/model'
import { hexFromColor, THEME_SLOT_GROUPS, themeFontModels, themeSlotGroup, type ThemePanelFontModel, type ThemePanelSlotModel } from './theme-panel'

export interface ThemeEditorControllerOptions {
  engine: EditorEngine
  slideId?: string
}

export interface ThemeEditorController {
  getState(): EngineState
  activeThemeId(slideId?: string): string | undefined
  slots(slideId?: string): readonly ThemePanelSlotModel[]
  fonts(slideId?: string): readonly ThemePanelFontModel[]
  setColor(slot: ThemeColorSlot, color: Color): EngineState
  resetColor(slot: ThemeColorSlot): EngineState
  setFont(slot: ThemeFontSlot, script: ThemeFontScript, typeface: string): EngineState
  resetFont(slot: ThemeFontSlot, script: ThemeFontScript): EngineState
}

const allSlots: readonly ThemeColorSlot[] = THEME_SLOT_GROUPS.flatMap((group) => [...group.slots])

function resolveThemeId(document: Ppt4aiDocument, slideId: string): string | undefined {
  const slide = document.slides[slideId]
  if (!slide) return undefined
  const layout = slide.layoutId ? document.layouts?.[slide.layoutId] : undefined
  const masterId = slide.masterId ?? layout?.masterId
  const themeId = masterId ? document.masters?.[masterId]?.themeId : undefined
  return themeId && document.themes?.[themeId] ? themeId : undefined
}

export function createThemeEditorController(options: ThemeEditorControllerOptions): ThemeEditorController {
  const targetSlide = (slideId?: string): string => {
    const resolved = slideId ?? options.slideId
    if (!resolved) throw new Error('slideId is required to resolve the active theme')
    return resolved
  }

  const dispatchColor = (slot: ThemeColorSlot, color: Color | null): EngineState => {
    const slideId = targetSlide()
    const themeId = resolveThemeId(options.engine.getState().document, slideId)
    if (!themeId) throw new Error(`no active theme for slide: ${slideId}`)
    return options.engine.dispatch({ type: 'setThemeColor', themeId, slot, color })
  }

  const dispatchFont = (slot: ThemeFontSlot, script: ThemeFontScript, typeface: string | null): EngineState => {
    const slideId = targetSlide()
    const themeId = resolveThemeId(options.engine.getState().document, slideId)
    if (!themeId) throw new Error(`no active theme for slide: ${slideId}`)
    return options.engine.dispatch({ type: 'setThemeFont', themeId, slot, script, typeface })
  }

  return {
    getState: () => options.engine.getState(),
    activeThemeId: (slideId) => resolveThemeId(options.engine.getState().document, targetSlide(slideId)),
    slots(slideId): readonly ThemePanelSlotModel[] {
      const document = options.engine.getState().document
      const themeId = resolveThemeId(document, targetSlide(slideId))
      const colors = themeId ? document.themes?.[themeId]?.colors : undefined
      if (!colors) return []
      return allSlots.map((slot) => {
        const value = colors[slot]
        return {
          slot,
          group: themeSlotGroup(slot),
          color: hexFromColor(value ?? DEFAULT_THEME_COLORS[slot], slot),
          isDefault: value === null,
          inherited: value === undefined,
        }
      })
    },
    setColor: (slot, color) => dispatchColor(slot, color),
    resetColor: (slot) => dispatchColor(slot, null),
    fonts(slideId): readonly ThemePanelFontModel[] {
      const document = options.engine.getState().document
      const themeId = resolveThemeId(document, targetSlide(slideId))
      const theme = themeId ? document.themes?.[themeId] : undefined
      return theme ? themeFontModels(theme.fonts) : []
    },
    setFont: (slot, script, typeface) => dispatchFont(slot, script, typeface),
    resetFont: (slot, script) => dispatchFont(slot, script, null),
  }
}

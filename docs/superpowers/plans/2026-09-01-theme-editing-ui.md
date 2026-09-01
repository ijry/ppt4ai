# 主题编辑 UI 与 history Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在编辑器里直接编辑 12 个主题颜色槽位并支持 undo/redo，把已完成的主题格式层接到 UI 上。

**Architecture:** `@ppt4ai/engine` 新增文档级 `setThemeColor` 命令，走既有 path-based patch/history 机制（`commit()` 自动生成 inverse）。`@ppt4ai/editor` 按既有「headless 类型模块 + controller + Vue 组件」三层分工新增主题面板；controller 复用 `slide → masterId → master.themeId` 链推断生效主题。渲染层不改动——`scenegraph.ts:275` 已从 master 链解析主题。

**Tech Stack:** TypeScript 6, Vue 3 (`script setup`), vue-i18n, UnoCSS, Vitest 4, happy-dom。

**Spec:** `docs/superpowers/specs/2026-09-01-theme-editing-ui-design.md`

## Global Constraints

- 保持 `@ppt4ai/model`、`@ppt4ai/engine` headless：不引入 Vue、DOM、Canvas、Element Plus 或 CSS 框架。
- 不新增运行时依赖。
- 不修改 `packages/render`：主题解析链已存在，改色应自动生效。
- `Theme.colors[slot]` 三态语义不可混淆：具体 `Color` = 显式色；`null` = 显式重置为 Office 默认值（**必须写进文档**）；`undefined` = 未设置、继承源主题。
- **关键陷阱**：既有 `setTableCellFill` 用 `value: fill ?? undefined` 把 `null` 折叠成 `undefined`，因为表格 fill 的 `null` 意为「删除属性」。主题语义相反 —— `null` 必须原样保留。不要照抄那个模式。
- 校验先在 clone 上跑，失败时 `this.document` 保持原值（对齐 `commitImageTransform`）。
- 不 mutate 传入的 document；`getState()` 返回 clone。
- i18n 键中英文同步新增，两个 locale 文件结构必须一致。
- 每个行为先写失败测试并**观察到失败**，再实现；每个任务独立提交。
- 任务末尾跑聚焦测试；全部任务完成后跑全量门禁：`pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm check:boundaries`、Element Plus 扫描、`git diff --check`。

## File Structure

| 文件 | 职责 |
|---|---|
| `packages/engine/src/index.ts`（改） | 新增 `setThemeColor` 命令类型、switch 分支、私有 `setThemeColor` 方法 |
| `packages/engine/src/engine.test.ts`（改） | 命令行为、history 往返、错误、无变化不入栈 |
| `packages/editor/src/theme-panel.ts`（新） | headless：props/emit 类型、槽位分组元数据、hex↔Color 纯函数 |
| `packages/editor/src/theme-panel.test.ts`（新） | 纯函数与元数据测试 |
| `packages/editor/src/theme-editor-controller.ts`（新） | 持 engine，推断生效主题，构建槽位模型，dispatch |
| `packages/editor/src/theme-editor-controller.test.ts`（新） | 主题链解析、三态映射、dispatch 透传 |
| `packages/editor/src/ThemePanel.vue`（新） | 12 槽位 UI、a11y、禁用态 |
| `packages/editor/src/ThemePanel.test.ts`（新） | 挂载渲染、emit 载荷、禁用态 |
| `packages/editor/src/locales/en-US.ts`、`zh-CN.ts`（改） | `panel.theme.*` 键 |
| `packages/editor/src/index.ts`（改） | 导出新公开 API |

---

### Task 1: engine `setThemeColor` 命令

**Files:**
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/src/engine.test.ts`

**Interfaces:**
- Consumes: `Theme`、`ThemeColorSlot`、`Color`、`DEFAULT_THEME_COLORS`（`@ppt4ai/model` 既有导出）
- Produces: `EngineCommand` 增加 `{ type: 'setThemeColor'; themeId: string; slot: ThemeColorSlot; color: Color | null }`

- [ ] **Step 1: 写失败测试**

在 `packages/engine/src/engine.test.ts` 末尾的 `describe` 内追加。先在文件顶部确认 `ThemeColorSlot` 已随其他 model 类型导入；若无则加入 import。

```ts
  it('sets a theme color slot and supports undo back to inheritance', () => {
    const document = structuredClone(baseDocument)
    document.themes = { theme_1: { id: 'theme_1', colors: {} } }
    document.masters = { master_1: { id: 'master_1', themeId: 'theme_1' } }
    const engine = new EditorEngine(document)

    const after = engine.dispatch({ type: 'setThemeColor', themeId: 'theme_1', slot: 'accent1', color: { type: 'srgb', v: 'FF0000' } })
    expect(after.document.themes?.theme_1?.colors.accent1).toEqual({ type: 'srgb', v: 'FF0000' })
    expect(after.history.undoDepth).toBe(1)

    const undone = engine.dispatch({ type: 'undo' })
    expect('accent1' in (undone.document.themes?.theme_1?.colors ?? {})).toBe(false)

    const redone = engine.dispatch({ type: 'redo' })
    expect(redone.document.themes?.theme_1?.colors.accent1).toEqual({ type: 'srgb', v: 'FF0000' })
  })

  it('resets a theme color slot to the Office default by writing null', () => {
    const document = structuredClone(baseDocument)
    document.themes = { theme_1: { id: 'theme_1', colors: { accent1: { type: 'srgb', v: 'FF0000' } } } }
    document.masters = { master_1: { id: 'master_1', themeId: 'theme_1' } }
    const engine = new EditorEngine(document)

    const after = engine.dispatch({ type: 'setThemeColor', themeId: 'theme_1', slot: 'accent1', color: null })

    expect(after.document.themes?.theme_1?.colors.accent1).toBeNull()
    expect(engine.dispatch({ type: 'undo' }).document.themes?.theme_1?.colors.accent1).toEqual({ type: 'srgb', v: 'FF0000' })
  })

  it('rejects unknown themes, unsupported slots, and invalid colors without mutating the document', () => {
    const document = structuredClone(baseDocument)
    document.themes = { theme_1: { id: 'theme_1', colors: { accent1: { type: 'srgb', v: 'FF0000' } } } }
    const engine = new EditorEngine(document)
    const before = engine.getState().document

    expect(() => engine.dispatch({ type: 'setThemeColor', themeId: 'missing', slot: 'accent1', color: null })).toThrow(/theme not found: missing/)
    expect(() => engine.dispatch({ type: 'setThemeColor', themeId: 'theme_1', slot: 'nope' as ThemeColorSlot, color: null })).toThrow(/unsupported theme color slot: nope/)
    expect(() => engine.dispatch({ type: 'setThemeColor', themeId: 'theme_1', slot: 'accent1', color: { type: 'srgb', v: 'ZZZ' } })).toThrow(/theme color is invalid/)
    expect(engine.getState().document).toEqual(before)
    expect(engine.getState().history.undoDepth).toBe(0)
  })

  it('ignores a theme color write that changes nothing', () => {
    const document = structuredClone(baseDocument)
    document.themes = { theme_1: { id: 'theme_1', colors: { accent1: { type: 'srgb', v: 'FF0000' } } } }
    const engine = new EditorEngine(document)

    const after = engine.dispatch({ type: 'setThemeColor', themeId: 'theme_1', slot: 'accent1', color: { type: 'srgb', v: 'FF0000' } })

    expect(after.history.undoDepth).toBe(0)
  })
```

若 `engine.test.ts` 中没有名为 `baseDocument` 的最小文档夹具，改用该文件既有的最小文档常量名（先 grep 文件顶部确认，不要新建重复夹具）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run packages/engine/src/engine.test.ts -t "theme color"`
Expected: FAIL —— `setThemeColor` 不是合法命令类型（TS 报错或运行期未命中 switch）。

- [ ] **Step 3: 加命令类型**

在 `packages/engine/src/index.ts` 的 `EngineCommand` 联合类型中，`setTableCellBorders` 之后插入一行：

```ts
  | { type: 'setThemeColor'; themeId: string; slot: ThemeColorSlot; color: Color | null }
```

并在文件第 1 行的 model import 中补入 `type Color`、`type ThemeColorSlot`、`type Theme`（按既有字母顺序插入，保持单行 import 风格）。

- [ ] **Step 4: 加 switch 分支**

在 `dispatch` 的 `case 'setTableCellBorders'` 之后插入：

```ts
      case 'setThemeColor': {
        this.setThemeColor(command.themeId, command.slot, command.color)
        break
      }
```

- [ ] **Step 5: 实现私有方法**

在 `setTableCellBorders` 私有方法之后插入。注意 `value: color` 直接传，**不要**写 `color ?? undefined`：

```ts
  private setThemeColor(themeId: string, slot: ThemeColorSlot, color: Color | null): void {
    if (!themeColorSlots.has(slot)) throw new Error(`unsupported theme color slot: ${slot}`)
    const nextDocument = clone(this.document)
    const theme = nextDocument.themes?.[themeId]
    if (!theme) throw new Error(`theme not found: ${themeId}`)
    theme.colors[slot] = color
    const validation = validateDocument(nextDocument)
    if (!validation.valid) throw new Error(`theme color is invalid: ${themeId}.${slot}: ${validation.errors.join('; ')}`)
    this.commit([{ path: ['themes', themeId, 'colors', slot], value: color }])
  }
```

在文件中已有的模块级常量附近（`tableBorderSides` 声明之后）加入槽位集合：

```ts
const themeColorSlots = new Set<ThemeColorSlot>(['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'])
```

- [ ] **Step 6: 跑测试确认通过**

patch 层无需改动 —— 已核实 `packages/engine/src/index.ts:110` 的 `toPatchValue` 只把 `undefined` 当缺失（`{ present: false }`），`null` 走 `{ present: true, value: null }`。三态语义在 patch/inverse 往返中天然成立，Task 1 的 `null` 测试即守住这一点。

Run: `pnpm vitest run packages/engine/src/engine.test.ts -t "theme color"`
Expected: PASS（4 项）。

- [ ] **Step 7: 跑整包测试与类型检查**

Run: `pnpm vitest run packages/engine && pnpm --filter @ppt4ai/engine typecheck`
Expected: 全部 PASS。

- [ ] **Step 8: 提交**

```bash
git add packages/engine/src/index.ts packages/engine/src/engine.test.ts
git commit -m "feat: add theme color engine command"
```

---

### Task 2: `theme-panel.ts` headless 类型与纯函数

**Files:**
- Create: `packages/editor/src/theme-panel.ts`
- Test: `packages/editor/src/theme-panel.test.ts`

**Interfaces:**
- Consumes: `Color`、`ThemeColorSlot`、`DEFAULT_THEME_COLORS`（`@ppt4ai/model`）
- Produces: `THEME_SLOT_GROUPS`、`themeSlotGroup(slot)`、`hexFromColor(color)`、`colorFromHex(hex)`、`ThemePanelSlotModel`、`ThemePanelProps`、`ThemePanelEmit`

- [ ] **Step 1: 写失败测试**

Create `packages/editor/src/theme-panel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME_COLORS } from '@ppt4ai/model'
import { colorFromHex, hexFromColor, THEME_SLOT_GROUPS, themeSlotGroup } from './theme-panel'

describe('theme panel metadata', () => {
  it('covers all twelve slots exactly once across groups', () => {
    const slots = THEME_SLOT_GROUPS.flatMap((group) => group.slots)

    expect(slots).toHaveLength(12)
    expect(new Set(slots).size).toBe(12)
    expect(Object.keys(DEFAULT_THEME_COLORS).every((slot) => slots.includes(slot as never))).toBe(true)
  })

  it('groups slots by neutral, accent, and hyperlink', () => {
    expect(themeSlotGroup('dk1')).toBe('neutral')
    expect(themeSlotGroup('accent3')).toBe('accent')
    expect(themeSlotGroup('folHlink')).toBe('hyperlink')
  })
})

describe('theme panel color conversion', () => {
  it('renders srgb colors as uppercase hex input values', () => {
    expect(hexFromColor({ type: 'srgb', v: 'ff0000' })).toBe('#FF0000')
  })

  it('falls back to the slot default for colors without a direct hex value', () => {
    expect(hexFromColor({ type: 'scheme', v: 'accent1' }, 'accent2')).toBe(`#${DEFAULT_THEME_COLORS.accent2.v}`)
  })

  it('parses hex input into srgb colors and rejects malformed input', () => {
    expect(colorFromHex('#00ff00')).toEqual({ type: 'srgb', v: '00FF00' })
    expect(colorFromHex('nope')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run packages/editor/src/theme-panel.test.ts`
Expected: FAIL —— 无法解析 `./theme-panel`。

- [ ] **Step 3: 实现模块**

Create `packages/editor/src/theme-panel.ts`:

```ts
import { DEFAULT_THEME_COLORS, type Color, type ThemeColorSlot } from '@ppt4ai/model'

export type ThemeSlotGroup = 'neutral' | 'accent' | 'hyperlink'

export const THEME_SLOT_GROUPS: readonly { group: ThemeSlotGroup; slots: readonly ThemeColorSlot[] }[] = [
  { group: 'neutral', slots: ['dk1', 'lt1', 'dk2', 'lt2'] },
  { group: 'accent', slots: ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] },
  { group: 'hyperlink', slots: ['hlink', 'folHlink'] },
]

export interface ThemePanelSlotModel {
  readonly slot: ThemeColorSlot
  readonly group: ThemeSlotGroup
  readonly color: string
  readonly isDefault: boolean
  readonly inherited: boolean
}

export interface ThemePanelProps {
  readonly active: boolean
  readonly slots: readonly ThemePanelSlotModel[]
}

export type ThemePanelEmit = {
  (event: 'set-color', slot: ThemeColorSlot, color: Color): void
  (event: 'reset-color', slot: ThemeColorSlot): void
}

export function themeSlotGroup(slot: ThemeColorSlot): ThemeSlotGroup {
  const found = THEME_SLOT_GROUPS.find((entry) => entry.slots.includes(slot))
  if (!found) throw new Error(`unsupported theme color slot: ${slot}`)
  return found.group
}

export function hexFromColor(color: Color, slot?: ThemeColorSlot): string {
  if (color.type === 'srgb' && /^[0-9a-fA-F]{6}$/.test(color.v)) return `#${color.v.toUpperCase()}`
  const fallback = slot ? DEFAULT_THEME_COLORS[slot] : DEFAULT_THEME_COLORS.dk1
  return `#${fallback.v.toUpperCase()}`
}

export function colorFromHex(value: string): Color | undefined {
  const normalized = value.replace(/^#/, '').toUpperCase()
  return /^[0-9A-F]{6}$/.test(normalized) ? { type: 'srgb', v: normalized } : undefined
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run packages/editor/src/theme-panel.test.ts`
Expected: PASS（5 项）。

- [ ] **Step 5: 提交**

```bash
git add packages/editor/src/theme-panel.ts packages/editor/src/theme-panel.test.ts
git commit -m "feat: add theme panel slot metadata"
```

---

### Task 3: `theme-editor-controller.ts`

**Files:**
- Create: `packages/editor/src/theme-editor-controller.ts`
- Test: `packages/editor/src/theme-editor-controller.test.ts`

**Interfaces:**
- Consumes: `EditorEngine`、`EngineState`（`@ppt4ai/engine`）；Task 2 的 `hexFromColor`、`themeSlotGroup`、`THEME_SLOT_GROUPS`、`ThemePanelSlotModel`
- Produces: `createThemeEditorController(options)` → `ThemeEditorController { getState, activeThemeId, slots, setColor, resetColor }`

- [ ] **Step 1: 写失败测试**

Create `packages/editor/src/theme-editor-controller.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { EditorEngine } from '@ppt4ai/engine'
import { DEFAULT_THEME_COLORS, type Ppt4aiDocument } from '@ppt4ai/model'
import { createThemeEditorController } from './theme-editor-controller'

function documentWithTheme(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    slideSize: { width: 12192000, height: 6858000 },
    slideOrder: ['slide_1'],
    slides: { slide_1: { id: 'slide_1', elementIds: [], layoutId: 'layout_1' } },
    layouts: { layout_1: { id: 'layout_1', masterId: 'master_1' } },
    masters: { master_1: { id: 'master_1', themeId: 'theme_1' } },
    themes: { theme_1: { id: 'theme_1', colors: { accent1: { type: 'srgb', v: 'FF0000' }, accent2: null } } },
    elements: {},
  }
}

describe('createThemeEditorController', () => {
  it('resolves the active theme through the layout master chain', () => {
    const controller = createThemeEditorController({ engine: new EditorEngine(documentWithTheme()) })

    expect(controller.activeThemeId('slide_1')).toBe('theme_1')
  })

  it('prefers an explicit slide master over the layout master', () => {
    const document = documentWithTheme()
    document.masters!.master_2 = { id: 'master_2', themeId: 'theme_2' }
    document.themes!.theme_2 = { id: 'theme_2', colors: {} }
    document.slides.slide_1!.masterId = 'master_2'
    const controller = createThemeEditorController({ engine: new EditorEngine(document) })

    expect(controller.activeThemeId('slide_1')).toBe('theme_2')
  })

  it('returns undefined when no theme is reachable', () => {
    const document = documentWithTheme()
    delete document.masters!.master_1!.themeId
    const controller = createThemeEditorController({ engine: new EditorEngine(document) })

    expect(controller.activeThemeId('slide_1')).toBeUndefined()
    expect(controller.slots('slide_1')).toEqual([])
  })

  it('maps explicit, reset, and inherited slots to display models', () => {
    const controller = createThemeEditorController({ engine: new EditorEngine(documentWithTheme()) })
    const slots = controller.slots('slide_1')
    const bySlot = new Map(slots.map((entry) => [entry.slot, entry]))

    expect(slots).toHaveLength(12)
    expect(bySlot.get('accent1')).toMatchObject({ color: '#FF0000', isDefault: false, inherited: false, group: 'accent' })
    expect(bySlot.get('accent2')).toMatchObject({ color: `#${DEFAULT_THEME_COLORS.accent2.v}`, isDefault: true, inherited: false })
    expect(bySlot.get('dk1')).toMatchObject({ color: `#${DEFAULT_THEME_COLORS.dk1.v}`, isDefault: true, inherited: true, group: 'neutral' })
  })

  it('dispatches color edits and resets for the active theme', () => {
    const engine = new EditorEngine(documentWithTheme())
    const controller = createThemeEditorController({ engine, slideId: 'slide_1' })

    const edited = controller.setColor('accent3', { type: 'srgb', v: '112233' })
    expect(edited.document.themes?.theme_1?.colors.accent3).toEqual({ type: 'srgb', v: '112233' })

    const reset = controller.resetColor('accent1')
    expect(reset.document.themes?.theme_1?.colors.accent1).toBeNull()
  })

  it('throws when editing without a reachable theme', () => {
    const document = documentWithTheme()
    delete document.masters!.master_1!.themeId
    const controller = createThemeEditorController({ engine: new EditorEngine(document), slideId: 'slide_1' })

    expect(() => controller.resetColor('accent1')).toThrow(/no active theme for slide: slide_1/)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run packages/editor/src/theme-editor-controller.test.ts`
Expected: FAIL —— 无法解析 `./theme-editor-controller`。

- [ ] **Step 3: 实现 controller**

Create `packages/editor/src/theme-editor-controller.ts`:

```ts
import type { EditorEngine, EngineState } from '@ppt4ai/engine'
import { DEFAULT_THEME_COLORS, type Color, type Ppt4aiDocument, type ThemeColorSlot } from '@ppt4ai/model'
import { hexFromColor, THEME_SLOT_GROUPS, themeSlotGroup, type ThemePanelSlotModel } from './theme-panel'

export interface ThemeEditorControllerOptions {
  engine: EditorEngine
  slideId?: string
}

export interface ThemeEditorController {
  getState(): EngineState
  activeThemeId(slideId?: string): string | undefined
  slots(slideId?: string): readonly ThemePanelSlotModel[]
  setColor(slot: ThemeColorSlot, color: Color): EngineState
  resetColor(slot: ThemeColorSlot): EngineState
}

const allSlots: readonly ThemeColorSlot[] = THEME_SLOT_GROUPS.flatMap((group) => [...group.slots])

function resolveThemeId(document: Ppt4aiDocument, slideId: string): string | undefined {
  const slide = document.slides[slideId]
  if (!slide) return undefined
  const layout = slide.layoutId ? document.layouts?.[slide.layoutId] : undefined
  const masterId = slide.masterId ?? layout?.masterId
  const master = masterId ? document.masters?.[masterId] : undefined
  const themeId = master?.themeId
  return themeId && document.themes?.[themeId] ? themeId : undefined
}

export function createThemeEditorController(options: ThemeEditorControllerOptions): ThemeEditorController {
  const targetSlide = (slideId?: string): string => {
    const resolved = slideId ?? options.slideId
    if (!resolved) throw new Error('slideId is required to resolve the active theme')
    return resolved
  }

  const requireThemeId = (slideId: string): string => {
    const themeId = resolveThemeId(options.engine.getState().document, slideId)
    if (!themeId) throw new Error(`no active theme for slide: ${slideId}`)
    return themeId
  }

  const dispatchColor = (slot: ThemeColorSlot, color: Color | null): EngineState => {
    const slideId = targetSlide()
    return options.engine.dispatch({ type: 'setThemeColor', themeId: requireThemeId(slideId), slot, color })
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
        const inherited = value === undefined
        const effective = value ?? DEFAULT_THEME_COLORS[slot]
        return {
          slot,
          group: themeSlotGroup(slot),
          color: hexFromColor(effective, slot),
          isDefault: !inherited && value === null,
          inherited,
        }
      })
    },
    setColor: (slot, color) => dispatchColor(slot, color),
    resetColor: (slot) => dispatchColor(slot, null),
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run packages/editor/src/theme-editor-controller.test.ts`
Expected: PASS（6 项）。

- [ ] **Step 5: 提交**

```bash
git add packages/editor/src/theme-editor-controller.ts packages/editor/src/theme-editor-controller.test.ts
git commit -m "feat: add theme editor controller"
```

---

### Task 4: i18n 键

**Files:**
- Modify: `packages/editor/src/locales/en-US.ts`
- Modify: `packages/editor/src/locales/zh-CN.ts`

**Interfaces:**
- Produces: `panel.theme.title`、`panel.theme.reset`、`panel.theme.groups.{neutral,accent,hyperlink}`、`panel.theme.slots.<slot>`（12 个）、`panel.theme.inherited`

- [ ] **Step 1: 加英文键**

在 `packages/editor/src/locales/en-US.ts` 顶层对象内（与 `editor`、`toolbar` 同级）加入 `panel` 段。若文件已有 `panel` 键则合并进去，不要重复声明：

```ts
  panel: {
    theme: {
      title: 'Theme colors',
      reset: 'Reset to Office default',
      inherited: 'Inherited from source theme',
      groups: {
        neutral: 'Dark and light',
        accent: 'Accents',
        hyperlink: 'Hyperlinks',
      },
      slots: {
        dk1: 'Dark 1',
        lt1: 'Light 1',
        dk2: 'Dark 2',
        lt2: 'Light 2',
        accent1: 'Accent 1',
        accent2: 'Accent 2',
        accent3: 'Accent 3',
        accent4: 'Accent 4',
        accent5: 'Accent 5',
        accent6: 'Accent 6',
        hlink: 'Hyperlink',
        folHlink: 'Followed hyperlink',
      },
    },
  },
```

- [ ] **Step 2: 加中文键**

在 `packages/editor/src/locales/zh-CN.ts` 相同位置加入结构完全一致的段：

```ts
  panel: {
    theme: {
      title: '主题颜色',
      reset: '重置为 Office 默认值',
      inherited: '继承源主题',
      groups: {
        neutral: '明暗色',
        accent: '强调色',
        hyperlink: '超链接',
      },
      slots: {
        dk1: '深色 1',
        lt1: '浅色 1',
        dk2: '深色 2',
        lt2: '浅色 2',
        accent1: '强调色 1',
        accent2: '强调色 2',
        accent3: '强调色 3',
        accent4: '强调色 4',
        accent5: '强调色 5',
        accent6: '强调色 6',
        hlink: '超链接',
        folHlink: '已访问超链接',
      },
    },
  },
```

- [ ] **Step 3: 类型检查**

Run: `pnpm --filter @ppt4ai/editor typecheck`
Expected: PASS —— 两个 locale 的 `as const` 结构一致，vue-i18n 键类型不冲突。

- [ ] **Step 4: 提交**

```bash
git add packages/editor/src/locales/en-US.ts packages/editor/src/locales/zh-CN.ts
git commit -m "feat: add theme panel translations"
```

---

### Task 5: `ThemePanel.vue`

**Files:**
- Create: `packages/editor/src/ThemePanel.vue`
- Test: `packages/editor/src/ThemePanel.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `ThemePanelProps`、`ThemePanelEmit`、`colorFromHex`、`THEME_SLOT_GROUPS`；Task 4 的 i18n 键
- Produces: 默认导出组件 `ThemePanel`

- [ ] **Step 1: 写失败测试**

Create `packages/editor/src/ThemePanel.test.ts`:

```ts
// @vitest-environment happy-dom

import { createApp, h } from 'vue'
import { describe, expect, it } from 'vitest'
import type { ThemePanelSlotModel } from './theme-panel'
import ThemePanel from './ThemePanel.vue'
import { createPpt4aiI18n } from './i18n'

const slots: ThemePanelSlotModel[] = [
  { slot: 'dk1', group: 'neutral', color: '#000000', isDefault: true, inherited: true },
  { slot: 'accent1', group: 'accent', color: '#FF0000', isDefault: false, inherited: false },
  { slot: 'hlink', group: 'hyperlink', color: '#0563C1', isDefault: true, inherited: false },
]

function mountPanel(active: boolean) {
  const events: { colors: unknown[]; resets: unknown[] } = { colors: [], resets: [] }
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup: () => () => h(ThemePanel, {
      active,
      slots,
      'onSet-color': (slot: unknown, color: unknown) => events.colors.push([slot, color]),
      'onReset-color': (slot: unknown) => events.resets.push(slot),
    }),
  })
  app.use(createPpt4aiI18n('en-US'))
  app.mount(host)
  return { app, host, events }
}

describe('ThemePanel', () => {
  it('renders one color input and reset button per slot with group labels', () => {
    const { app, host } = mountPanel(true)

    expect(host.querySelectorAll('input[type="color"]')).toHaveLength(3)
    expect(host.querySelectorAll('button[data-action="reset-slot"]')).toHaveLength(3)
    expect(host.querySelectorAll('[data-slot-group]')).toHaveLength(3)
    expect(host.querySelector('input[data-slot="accent1"]')?.getAttribute('value')).toBe('#FF0000')
    expect(host.querySelector('[data-slot-row="dk1"]')?.getAttribute('data-inherited')).toBe('true')

    app.unmount()
    host.remove()
  })

  it('disables every control when inactive', () => {
    const { app, host } = mountPanel(false)

    expect(host.querySelectorAll('input:disabled')).toHaveLength(3)
    expect(host.querySelectorAll('button:disabled')).toHaveLength(3)

    app.unmount()
    host.remove()
  })

  it('emits parsed colors on change and the slot on reset', () => {
    const { app, host, events } = mountPanel(true)
    const input = host.querySelector('input[data-slot="accent1"]') as HTMLInputElement
    input.value = '#00ff00'
    input.dispatchEvent(new Event('change'))
    ;(host.querySelector('button[data-slot="hlink"]') as HTMLButtonElement).click()

    expect(events.colors).toEqual([['accent1', { type: 'srgb', v: '00FF00' }]])
    expect(events.resets).toEqual(['hlink'])

    app.unmount()
    host.remove()
  })

  it('ignores malformed color input', () => {
    const { app, host, events } = mountPanel(true)
    const input = host.querySelector('input[data-slot="dk1"]') as HTMLInputElement
    input.value = 'nope'
    input.dispatchEvent(new Event('change'))

    expect(events.colors).toEqual([])

    app.unmount()
    host.remove()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run packages/editor/src/ThemePanel.test.ts`
Expected: FAIL —— 无法解析 `./ThemePanel.vue`。

- [ ] **Step 3: 实现组件**

Create `packages/editor/src/ThemePanel.vue`。分组展示但保持平铺（不折叠），只按组渲染小标题：

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ThemeColorSlot } from '@ppt4ai/model'
import { colorFromHex, THEME_SLOT_GROUPS, type ThemePanelEmit, type ThemePanelProps } from './theme-panel'

const props = defineProps<ThemePanelProps>()
const emit = defineEmits<ThemePanelEmit>()
const { t } = useI18n()

const groups = computed(() => THEME_SLOT_GROUPS
  .map((entry) => ({ group: entry.group, slots: props.slots.filter((model) => model.group === entry.group) }))
  .filter((entry) => entry.slots.length > 0))

function change(slot: ThemeColorSlot, event: Event): void {
  const color = colorFromHex((event.target as HTMLInputElement).value)
  if (color) emit('set-color', slot, color)
}
</script>

<template>
  <section class="flex flex-col gap-2 border-l border-slate-200 bg-white p-2" data-theme-panel :aria-label="t('panel.theme.title')">
    <h2 class="text-sm font-medium text-slate-700">{{ t('panel.theme.title') }}</h2>
    <div v-for="entry in groups" :key="entry.group" class="flex flex-col gap-1" data-slot-group :data-group="entry.group">
      <h3 class="text-xs text-slate-500">{{ t(`panel.theme.groups.${entry.group}`) }}</h3>
      <div
        v-for="model in entry.slots"
        :key="model.slot"
        class="flex items-center gap-2"
        data-slot-row
        :data-slot-row="model.slot"
        :data-inherited="model.inherited ? 'true' : 'false'"
      >
        <input
          type="color"
          class="h-8 w-8 cursor-pointer border border-slate-300 p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          :data-slot="model.slot"
          :aria-label="t(`panel.theme.slots.${model.slot}`)"
          :disabled="!props.active"
          :value="model.color"
          @change="change(model.slot, $event)"
        >
        <span class="flex-1 text-sm text-slate-700">{{ t(`panel.theme.slots.${model.slot}`) }}</span>
        <span v-if="model.inherited" class="text-xs text-slate-400">{{ t('panel.theme.inherited') }}</span>
        <button
          type="button"
          class="h-8 border border-transparent px-2 text-sm text-slate-700 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          data-action="reset-slot"
          :data-slot="model.slot"
          :aria-label="t('panel.theme.reset')"
          :disabled="!props.active"
          @click="emit('reset-color', model.slot)"
        >
          {{ t('panel.theme.reset') }}
        </button>
      </div>
    </div>
  </section>
</template>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run packages/editor/src/ThemePanel.test.ts`
Expected: PASS（4 项）。

若 `input[value]` 断言因 Vue 用 property 而非 attribute 绑定而失败，把断言改为读 `(el as HTMLInputElement).value`，不要为了迁就测试给组件加多余属性。

- [ ] **Step 5: 提交**

```bash
git add packages/editor/src/ThemePanel.vue packages/editor/src/ThemePanel.test.ts
git commit -m "feat: add theme panel component"
```

---

### Task 6: 导出公开 API 并跑全量门禁

**Files:**
- Modify: `packages/editor/src/index.ts`

**Interfaces:**
- Consumes: Task 2、3、5 的全部产物
- Produces: `@ppt4ai/editor` 公开导出 `ThemePanel`、`createThemeEditorController` 及相关类型

- [ ] **Step 1: 追加导出**

在 `packages/editor/src/index.ts` 末尾追加（沿用文件既有的 `export { default as X } from './X.vue'` 风格）：

```ts
export { default as ThemePanel } from './ThemePanel.vue'
export { colorFromHex, hexFromColor, THEME_SLOT_GROUPS, themeSlotGroup } from './theme-panel'
export type { ThemePanelEmit, ThemePanelProps, ThemePanelSlotModel, ThemeSlotGroup } from './theme-panel'
export { createThemeEditorController } from './theme-editor-controller'
export type { ThemeEditorController, ThemeEditorControllerOptions } from './theme-editor-controller'
```

- [ ] **Step 2: 全量测试**

Run: `pnpm test`
Expected: 全部 PASS，总数为原 627 项加本次新增（engine 4 + theme-panel 5 + controller 6 + ThemePanel 4 = 19），即 646 项。若实际数不符，先核对是否有测试被漏写或重复。

- [ ] **Step 3: 类型检查与构建**

Run: `pnpm typecheck && pnpm build`
Expected: 全部 PASS。

- [ ] **Step 4: 边界与依赖扫描**

Run: `pnpm check:boundaries`
Expected: `Package boundaries OK (12 packages)`。

Run: `git grep -ln "element-plus" -- packages apps`
Expected: 无输出。

- [ ] **Step 5: 空白检查**

Run: `git diff --check`
Expected: 无输出。

- [ ] **Step 6: 提交**

```bash
git add packages/editor/src/index.ts
git commit -m "feat: export theme panel api"
```

---

### Task 7: 记录里程碑

**Files:**
- Modify: `进度.md`

- [ ] **Step 1: 更新状态行与里程碑段**

把第 3 行的 `**当前阶段**` 改为「阶段 6 主题编辑 UI 与 history 切片已完成」，并在第 11 行既有里程碑段**之前**插入新段。段落须包含：engine 新增命令与 history 语义、controller 主题链解析、面板 12 槽位与重置动作、i18n、实测测试数（engine/editor 聚焦数与全仓总数，用 Step 2 的真实数字，不要照抄计划里的预估）、通过的门禁清单、实现提交 SHA、以及仍延期的项（字体/格式方案、恢复继承动作、主题增删切换、PowerPoint/LibreOffice 人工验证）。

- [ ] **Step 2: 核实数字**

Run: `pnpm vitest run packages/engine packages/editor 2>&1 | tail -6`
把真实的测试文件数与项数写进里程碑，不要用预估值。

- [ ] **Step 3: 提交**

```bash
git add "进度.md"
git commit -m "docs: record theme editing ui milestone"
```

---

## Self-Review

**Spec coverage:**

| Spec 章节 | 实现任务 |
|---|---|
| §3 架构三层分工 | Task 1（engine）、2（headless）、3（controller）、5（组件） |
| §4 决策 1 单槽位命令 | Task 1 Step 3-5 |
| §4 决策 2 themeId 显式传入 | Task 1 命令签名；Task 3 `requireThemeId` |
| §4 决策 3 只有重置→`null` | Task 1 `null` 保留；Task 3 `resetColor`；Task 5 单个 reset 按钮 |
| §4 决策 4 12 槽位平铺 + 分组元数据 | Task 2 `THEME_SLOT_GROUPS`；Task 5 按组渲染不折叠 |
| §4 决策 5 无主题禁用不报错 | Task 3 `slots` 返回 `[]`；Task 5 `active` 禁用；Task 3 测试覆盖抛错路径 |
| §5 组件契约 | Task 2、3 的类型定义逐项对应 |
| §6 错误处理 | Task 1 Step 5 三类错误；Task 3 `no active theme`；Task 5 malformed 输入忽略 |
| §7 测试策略 | Task 1、2、3、5 各自的测试；Task 6 门禁 |
| §8 验收标准 1-6 | 1→Task 5+渲染链未改；2→Task 1；3→Task 1 undo 测试；4→Task 3/5；5→既有写回未改动；6→Task 6 |

Spec §5 中 `activeThemeId(slideId: string)` 与 `slots(slideId: string)` 为必填参数，计划里放宽为可选并回落到 `options.slideId`，因为面板通常绑定固定当前页。这是对 spec 的收紧兼容（仍可显式传入），已在 Task 3 的类型中明确。

**Placeholder scan:** 无 TBD/TODO；每个代码步骤含完整可粘贴代码;错误处理均给出具体错误消息与断言。

**Type consistency:** `ThemePanelSlotModel` 字段（`slot`/`group`/`color`/`isDefault`/`inherited`）在 Task 2 定义、Task 3 构建、Task 5 消费,三处一致。`setThemeColor` 命令的四个字段在 Task 1 定义、Task 3 调用处一致。`themeSlotGroup`、`hexFromColor`、`colorFromHex`、`THEME_SLOT_GROUPS` 在 Task 2 导出、Task 3/5 引用,命名一致。

**已核实的前提：** 三态语义依赖 patch 层区分 `null` 与 `undefined`。已确认 `packages/engine/src/index.ts:110` 的 `toPatchValue` 只把 `undefined` 视为缺失，`null` 保持 present，因此 patch/inverse 往返能精确还原继承态，无需改动 patch 层。

**主要风险：** 既有 `setTableCellFill` 用 `value: fill ?? undefined` 把 `null` 折叠为删除语义。实现 Task 1 时若照抄该模式，主题重置会退化成继承态，且 Task 1 的 `null` 测试会立刻失败 —— 这是有意设置的守卫。

# 主题编辑 UI 与 history 设计

**日期**：2026-09-01 · **阶段**：阶段 6 · **状态**：已批准，待实现

## 1. 目标

把已完成的主题格式层接到用户手上。当前 `@ppt4ai/model` 与 `@ppt4ai/pptx-export` 已支持主题颜色的源绑定、范围写回、standalone 序列化和重置为 Office 默认值，但 `packages/editor` 与 `packages/engine` 中 `theme` 零引用——主题只能靠代码构造文档来编辑。本切片补上 engine 命令、编辑器面板与 undo/redo 接线，消除「能导出但不能编辑」的缺口。

## 2. 范围

**做**：

- `@ppt4ai/engine` 新增文档级主题颜色命令，走既有 patch/history 机制
- `@ppt4ai/editor` 新增 headless 主题面板模型 + controller + Vue 组件，12 个槽位全部可编辑
- 每个槽位提供「重置为 Office 默认值」动作，写入 `null`
- 中英文 i18n 键
- 主题变化后画布重绘由既有渲染链自动覆盖

**不做**（明确延期）：

- 字体方案（`fontScheme`）与格式方案（`fmtScheme`）编辑
- 「恢复继承」动作（写入 `undefined`）——见 §4 决策 3
- 新建/删除/切换主题，master/layout 绑定编辑
- 主题预设或配色方案库
- PowerPoint/LibreOffice 人工阅读器验证（环境所限，一贯延期）

## 3. 架构

沿用项目既有的三层分工，不引入新模式：

```
ThemePanel.vue          ← 展示与输入，emit 意图
theme-panel.ts          ← headless props/emit 类型 + 槽位分组元数据
theme-editor-controller ← 持 engine，把意图翻译成 dispatch，返回 EngineState
@ppt4ai/engine          ← setThemeColor 命令 → commit() → patch + inverse
@ppt4ai/model           ← Theme.colors 三态、DEFAULT_THEME_COLORS、validateDocument
```

**数据流**（单向）：用户改色 → `ThemePanel` emit → controller `dispatch` → engine `commit(['themes', themeId, 'colors', slot])` → 新 `EngineState` → 渲染层按 `slide → masterId → master.themeId → themes[id]` 重新解析 scheme 色 → 画布重绘。

引用 scheme 色的元素会自动跟随，因为 `packages/render/src/scenegraph.ts:275` 已经从 master 链解析主题并交给 `resolveColor`。本切片不改渲染层。

## 4. 关键决策

**决策 1：命令按单槽位设计，不做批量**

新增 `{ type: 'setThemeColor'; themeId: string; slot: ThemeColorSlot; color: Color | null }`。

理由：patch 路径 `['themes', themeId, 'colors', slot]` 精确到槽位，`makePatch` 天然生成最小 diff，inverse 自动正确。批量命令会让一次 undo 撤销多个槽位，与用户「改了一个颜色」的心智模型不符。代价：连续调色会产生多条 history 记录，接受——与既有 `setImageRotation` 等命令的粒度一致。

**决策 2：`themeId` 由调用方显式传入，engine 不自己推断**

理由：engine 现有命令均为元素级，靠 selection 定位。主题是文档级，没有「当前主题」概念。让 engine 去推断会引入隐式状态。由 controller 用既有解析链算出当前页生效的主题 ID 再传入，职责清晰且可测。

**决策 3：只提供「重置为默认」→ `null`，不提供「恢复继承」→ `undefined`**

理由：`null` 与 `undefined` 语义不同——`null` 显式写入 Office 默认色，`undefined` 保持继承源主题原值。两个动作都暴露会让面板每槽位两个按钮，且需向用户解释差异。undo/redo 已能覆盖「改错了想回去」（inverse 会原样恢复 `undefined`）。已知代价：在已保存的文档里无法把某个槽位交还给源主题，只能手输原色值；若该场景出现需求，再补 `clearThemeColor` 命令。

**决策 4：面板 12 槽位平铺，不折叠分组**

理由：本切片目的是吃满格式层能力，只暴露 accent 会留下新缺口。12 个控件尚不拥挤，折叠交互的收益不足以偿付复杂度。`theme-panel.ts` 仍导出分组元数据（明暗 / accent / 超链接）供视觉分区与 `aria` 分组使用，为将来折叠留出接口而不现在实现。

**决策 5：无生效主题时面板禁用而非报错**

理由：文档可能没有 master 或 master 无 `themeId`（blank 文档即如此）。此时面板整体 `disabled`，与既有工具栏 `active` prop 的处理方式一致，不抛错。

## 5. 组件契约

**`@ppt4ai/engine`**

```ts
| { type: 'setThemeColor'; themeId: string; slot: ThemeColorSlot; color: Color | null }
```

- 主题不存在 → `throw new Error('theme not found: <id>')`
- 槽位非法 → `throw new Error('unsupported theme color slot: <slot>')`
- 颜色非法（走 `validateDocument`）→ `throw new Error('theme color is invalid: ...')`，文档不变
- 值未变化 → `makePatch` 产生空 patch，`commit` 直接返回，不污染 undo 栈
- 校验在 clone 上先行，失败时 `this.document` 保持原值（与 `commitImageTransform` 一致）

**`@ppt4ai/editor`**

```ts
// theme-panel.ts
export interface ThemePanelSlotModel {
  readonly slot: ThemeColorSlot
  readonly group: 'neutral' | 'accent' | 'hyperlink'
  readonly color: string          // #RRGGBB，供 <input type="color">
  readonly isDefault: boolean     // 当前值等于 Office 默认色
  readonly inherited: boolean     // 槽位为 undefined，继承源主题
}
export interface ThemePanelProps {
  readonly active: boolean
  readonly slots: readonly ThemePanelSlotModel[]
}
export type ThemePanelEmit = {
  (event: 'set-color', slot: ThemeColorSlot, color: Color): void
  (event: 'reset-color', slot: ThemeColorSlot): void
}

// theme-editor-controller.ts
export interface ThemeEditorController {
  getState(): EngineState
  activeThemeId(slideId: string): string | undefined
  slots(slideId: string): readonly ThemePanelSlotModel[]
  setColor(slot: ThemeColorSlot, color: Color): EngineState
  resetColor(slot: ThemeColorSlot): EngineState
}
```

`activeThemeId` 复用 `slide.masterId ?? layout?.masterId → master.themeId` 链。`slots` 对 `undefined` 槽位显示 `DEFAULT_THEME_COLORS` 作为展示值并标记 `inherited: true`，因为渲染时该槽位实际解析结果就是默认色。

## 6. 错误处理

- engine 层：非法输入抛稳定前缀错误，文档不被部分修改
- controller 层：无生效主题时 `setColor`/`resetColor` 抛错，UI 通过 `active: false` 事先阻止调用
- 面板层：非 6 位 hex 输入按既有 `colorValue()` 惯例回落，不抛错
- 不新增全局错误提示机制，与既有面板保持一致

## 7. 测试策略

TDD,每个行为先见红。

- `packages/engine/src/engine.test.ts`：单槽位写入、`null` 重置、undo/redo 往返（含 `undefined → 色 → undo` 恢复为 `undefined`）、非法主题/槽位/颜色、无变化不入栈、文档不被 mutate
- `packages/editor/src/theme-editor-controller.test.ts`：`activeThemeId` 沿 master 链解析（含 `layout.masterId` 回落）、无主题返回 `undefined`、`slots` 三态映射、dispatch 透传
- `packages/editor/src/ThemePanel.test.ts`：12 槽位渲染、`aria-label` 与分组、`disabled` 状态、change 与 reset 的 emit 载荷
- `packages/editor/src/theme-panel.test.ts`：槽位元数据与 hex 转换纯函数

**门禁**（与既有切片一致）：全仓 `pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm check:boundaries`、Element Plus 扫描、`git diff --check`。

## 8. 验收标准

1. 12 个槽位均可改色，改动即时反映到画布上引用 scheme 色的元素
2. 每槽位「重置为默认」写入 `null`，导出后 XML 含对应 Office 默认色
3. undo/redo 精确还原单槽位改动，包括还原到 `undefined` 继承态
4. 无生效主题时面板禁用且不抛错
5. 改色后 `exportPptx` 走既有范围写回，源包未涉及部分字节不变
6. 全部门禁通过；不新增运行时依赖，不引入 Element Plus/DOM 依赖到 headless 包

# 主题字体面板设计

> 状态：待实现（2026-09-03）
> 日期：2026-09-03

## 1. 目标

让主题字体能在界面上改：`ThemePanel` 加字体行，`theme-editor-controller` 加方法，playground 接线到 `setThemeFont`。

## 2. 现状

模型、导入、解析、导出、写回、engine 命令都已就位（`de59927`、`dbf976d`）。缺的只有 UI —— `ThemePanel` 只有 12 个颜色槽位，`theme-editor-controller` 只有 `slots`/`setColor`/`resetColor`，playground 的 `asset-host`/`presentation-host` 只有 `setThemeColor`。

**核实过一件事**：`TextFormattingToolbar` 的字体下拉用的是 `fontFamilies` **prop**，由宿主传入；它本身尚未在 playground 挂载，所以仓里**没有任何字体清单常量**。字体候选从哪来是本切片要定的。

## 3. 关键决策

**决策 1：字体行用文本输入 + `datalist` 建议，不用 `select`**

主题字体是**写进文件的字体名**，不必在本机存在（PowerPoint 会做替换），而导入的主题带的是任意名字（Cambria、宋体、等线…）。`select` 只有两条路：宿主清单没有该名字就显示空（面板说谎），或者为当前值造一个合成 option。文本输入 + `datalist` 两头都占：任意值可输入可显示，同时给宿主清单当建议。

浏览器无权枚举系统字体（`queryLocalFonts()` 仅 Chromium 且要权限弹窗），所以**不做「可用字体探测」**；候选清单沿用 `TextFormattingToolbarProps.fontFamilies` 那套「宿主传入」的既有做法，`ThemePanelProps` 加 `fontFamilies`。

**决策 2：六行全开（major/minor × latin/ea/cs），按 slot 分组**

结构镜像颜色面板的 group → row。**`ea`/`cs` 明知当前不影响画布也要开**：导入端只读 `<a:latin>` 进 `marks.fontFamily`，所以 `+mj-ea` 这类引用我们根本产生不了，改 `ea` 只改导出的文件与 PowerPoint 的中日韩排版。但它是主题的真实字段、写回已支持，UI 里藏掉反而制造「命令能改、界面不能改」的缺口。已知限制里写明。

**决策 3：空输入不发事件，回默认走重置按钮**

镜像颜色面板（解析不出颜色就不 emit，重置写 `null`）。输入值 trim 后 emit；与当前值相同的写入不必在 UI 层挡，engine 的 `makePatch` 已经丢弃无变化的补丁。

`ea`/`cs` 的内置默认值是空串，所以未设置时输入框就是空的 —— 这正是「无覆盖」的实情，不额外造占位文案。

**决策 4：面板标题从「主题颜色」改成「主题」，颜色与字体各一个小节**

`panel.theme.title` 现在是 `Theme colors`/`主题颜色`，加了字体就名不符实。新增 `panel.theme.colors`、`panel.theme.fonts` 两个小节标题，以及 `panel.theme.fontSlots.major|minor`、`panel.theme.fontScripts.latin|ea|cs`。**只有两处引用该标题**（`aria-label` 与 `h2`），无测试断言其文本。

**决策 5：controller 与 host 一比一镜像颜色那条链**

`fonts(slideId?)`、`setFont(slot, script, typeface)`、`resetFont(slot, script)`；`asset-host.setThemeFont(themeId, slot, script, typeface)`；`presentation-host.setThemeFont(slot, script, typeface)`。**不趁机把 playground 改成用 controller** —— App.vue 现在自己算 `themeSlots` 并走 host，controller 只被自己的测试用；统一两条路是独立清理，混进来会让本切片的 diff 失焦。

**决策 6：候选清单放 playground，不放 editor 包**

editor 不该对「有哪些字体」有意见。playground 作为 demo 宿主给一份常见中英文字体清单（Aptos / Arial / Calibri / Cambria / Georgia / Times New Roman / 宋体 / 等线 / 微软雅黑），并明确它是建议而非可用性保证。

## 4. 契约（增量）

```ts
export interface ThemePanelFontModel {
  readonly slot: ThemeFontSlot
  readonly script: ThemeFontScript
  readonly typeface: string      // 生效值：模型值 ?? 内置默认
  readonly isDefault: boolean    // 模型值为 null
  readonly inherited: boolean    // 模型值为 undefined
}
```

`ThemePanelProps` 加 `fonts: readonly ThemePanelFontModel[]` 与 `fontFamilies: readonly string[]`；`ThemePanelEmit` 加 `set-font(slot, script, typeface)`、`reset-font(slot, script)`。两个新字段都是必填 —— 面板只有 playground 一个调用点，加可选字段只会让「忘了传」静默通过。

新增导出：`THEME_FONT_ROWS`（六行的固定顺序）、`ThemePanelFontModel`。

## 5. 测试策略

- **ThemePanel**：六个字体输入 + 六个重置按钮渲染出来；`datalist` 选项来自 `fontFamilies`；输入框显示生效值（`ea` 未设置时为空）；改一个输入 emit `(slot, script, trim 后的值)`；空输入不 emit；重置 emit `(slot, script)`；inactive 时全部 disabled（含新增控件）
- **controller**：`fonts()` 的 `inherited`/`isDefault` 与生效值正确；`setFont`/`resetFont` 落到 engine 且 undo 可回；无主题时 `fonts()` 为空数组
- **playground**：`asset-host` 与 `presentation-host` 的成功/失败状态；App 渲染出字体行并把改动传到 engine

## 6. 已知限制

- `ea`/`cs` 的改动不影响本项目画布（导入只读 `<a:latin>`），只影响导出的文件（决策 2）
- 候选清单是写死的建议，不代表本机可用字体（决策 6）
- App.vue 与 `theme-editor-controller` 仍是两条并行的取数路径（决策 5）
- 工具栏字体框对主题引用的 run 仍显示 `+mj-lt` 字面值
- `fmtScheme` 仍不在模型中

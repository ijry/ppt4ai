# 幻灯片背景图案编辑控件设计

> 状态：已实现（2026-09-21）
> 日期：2026-09-21

## 1. 目标

继渐变编辑器之后,给 `SlideBackgroundPanel` 加**图案背景编辑器**(预设 + 前景/背景两色)。图案背景已能读取/解析/绘制/写回,面板补上编辑。

## 2. 关键决策

**决策 1：预设只提供 `PAINTED_PRESET_PATTERNS`**

面板从模型导入 `PAINTED_PRESET_PATTERNS`(画得出的 36 个词)作为下拉项,不提供画不出的装饰词——避免"选了没效果"。`slideBackgroundModel` 从已解析的 `ResolvedPattern` 派生初值(预设、前景=fg、背景=bg);无图案时预设取列表首项、前景回落平色、背景回落白。

**决策 2：`backgroundPatternFrom(preset, fg, bg)` 构造 `Fill`**

校验预设在 `PAINTED_PRESET_PATTERNS` 内、两色为 hex,`Fill.color` 镜像前景(与导入/导出同规则)。面板三输入(预设 select + 两色板)各自 change 时读另两项合成图案发 `set-pattern`。en/zh 加 `patternEditor`/`patternPreset`/`patternForeground`/`patternBackground` 文案。

**决策 3：playground 接线**

`App.vue` 加 `setSlideBackgroundPattern(fill)` → `setSlideBackground({ fill })`,engine 与写回本就支持图案 fill,端到端可用。

## 3. 测试策略（TDD）

- **模型**（+3）：从图案派生预设/两色;`backgroundPatternFrom` 构造 fill 并镜像前景;拒未画预设与非法色。既有纯色 `toEqual` 补图案字段(`patternPresets: expect.any(Array)`)。
- **组件**（+1）：改预设 select→发 `set-pattern`(preset=pct25、前景镜像)。
- **回归**：全量 2457 项。

## 4. 已知限制

- 只提供画得出的预设;装饰族(`zigZag` 等)不在下拉里(画不出,不给假选项)。
- 面板仍不造图片背景(下一刀:资产选择器 + `set-picture`)。

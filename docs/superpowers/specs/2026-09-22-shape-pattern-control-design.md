# 形状图案填充编辑控件设计

> 状态：已实现（2026-09-22）
> 日期：2026-09-22

## 1. 目标

继形状渐变填充编辑之后,给 `ShapePaintToolbar` 加图案填充编辑(预设 + 前景/背景两色),与背景面板、文字工具栏的图案控件同构。

## 2. 关键决策

**决策 1：props 加可选 `fillIsPattern` + `fillPatternPreset/Foreground/Background`,`set-fill` 复用**

`PptEditor` 从 `node.resolvedFillPattern` 派生;预设下拉只列 `SHAPE_FILL_PATTERN_PRESETS`(= `PAINTED_PRESET_PATTERNS`,画得出的词)。`shapePatternFrom(preset, fg, bg)` 校验预设可画 + 两色 hex,`color` 镜像前景,发 `set-fill { color, pattern }`。

## 3. 测试策略（TDD）

- **组件**（+1）：改预设下拉→发 `set-fill`,`pattern.preset=pct25`。
- **回归**：全量 2466 项。

## 4. 已知限制

- 形状描边的渐变/图案编辑仍未做(props 未暴露 stroke 非纯色编辑)。
- 图案限可画预设(与背景/文字一致)。

**至此:纯色/渐变/图案填充在背景面板、文字工具栏、形状画刷三处的填充侧都可编辑。**

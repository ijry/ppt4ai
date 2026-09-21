# 形状描边渐变/图案编辑控件设计

> 状态：已实现（2026-09-22）
> 日期：2026-09-22

## 1. 目标

给 `ShapePaintToolbar` 的**描边(stroke)**加渐变/图案编辑,补齐填充编辑一致性的最后一块。此前描边只能设纯色,渐变仅只读提示。

## 2. 关键决策

**决策 1：props 加 stroke 渐变/图案编辑态,`set-stroke` 复用**

`strokeGradientStart/End/Angle`、`strokeIsPattern`、`strokePatternPreset/Foreground/Background`;`PptEditor` 从 `node.resolvedStrokeGradient`/`resolvedStrokePattern` 派生。描边控件复用 `shapeGradientFrom`/`shapePatternFrom`(与填充同构),发 `set-stroke { color, gradient|pattern }`——`set-stroke` 本就是 `Fill`,无需新事件。

## 3. 测试策略（TDD）

- **组件**（+2）：改描边渐变起色→发两停靠点 stroke;改描边图案预设→发 `pattern.preset=pct25`。
- **回归**：全量 2468 项。

## 4. 已知限制

- 图案描边在画布上按百分比合成色绘制(既有 `percentagePatternStroke` 取舍);渐变/图案限两停靠点线性/可画预设。

**至此:纯色/渐变/图案在背景面板、文字工具栏、形状画刷(填充+描边)全处可编辑——填充编辑一致性收口。**

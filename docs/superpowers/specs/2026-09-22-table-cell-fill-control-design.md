# 表格单元格渐变/图案填充编辑控件设计

> 状态：已实现（2026-09-22）
> 日期：2026-09-22

## 1. 目标

`TableFormattingToolbar` 此前单元格填充只能设纯色。单元格渐变/图案填充已能绘制/往返(前几刀),补上编辑器——复用形状工具栏的构造器,填充编辑一致性覆盖到表格单元格。

## 2. 关键决策

**决策 1：复用 `shapeGradientFrom`/`shapePatternFrom`,`set-fill` 发同款 `Fill`**

`TableFormattingToolbarProps` 加 `fillGradientStart/End/Angle` 与 `fillPatternPreset/Foreground/Background`;`PptEditor` 从 `cell.resolvedFillGradient`/`resolvedFillPattern` 派生。渐变(起/止/角)与图案(预设+两色)控件发 `set-fill { color, gradient|pattern }`,与形状/背景/文字同规则。图案预设下拉限 `SHAPE_FILL_PATTERN_PRESETS`(可画词)。

## 3. 测试策略（TDD）

- **组件**（+1,计数更新 select 2→3、色板 2→6）：改渐变起色→发两停靠点 fill;改图案预设→发 `pattern.preset=pct25`。
- **回归**：全量 2469 项。

## 4. 已知限制

- 渐变限两停靠点线性、图案限可画预设(全项目一致)。
- 单元格边框仍纯色(边框不建模渐变/图案,OOXML 亦然)。

**至此:纯色/渐变/图案填充在背景面板、文字工具栏、形状(填充+描边)、表格单元格四类目标全可编辑——填充编辑一致性完整。**

# 形状渐变填充编辑控件设计

> 状态：已实现（2026-09-22）
> 日期：2026-09-22

## 1. 目标

`ShapePaintToolbar` 此前遇到渐变填充只显示"渐变"字样、不能编辑,只能设纯色。形状渐变填充已能绘制/往返,补上编辑器——与背景面板、文字工具栏的渐变编辑器同构。

## 2. 关键决策

**决策 1：props 加可选 `fillGradientStart/End/Angle`,`set-fill` 复用**

`ShapePaintToolbarProps` 增三个可选字段(渐变起/止/角);`PptEditor` 从 `node.resolvedFillGradient` 的停靠点与角度派生。渐变控件发的仍是 `set-fill { color, gradient }`(形状 fill 命令本就是 `Fill`),无需新事件。

**决策 2：`shapeGradientFrom(start, end, angle)` 与背景/文字同规则**

拒非法 hex 与非有限角度、角度归一 0..359 换算 60000ths、两停靠点、`color` 取起色。控件各自 change 时读另两项(缺省回落 `fillColor`/白/0)合成。

## 3. 测试策略（TDD）

- **组件**（`ShapePaintToolbar.test.ts`,+1）：改渐变起色→发两停靠点 fill、`color.v=FF0000`。
- **回归**：全量 2465 项。

## 4. 已知限制

- 形状描边的渐变编辑未做(props 未暴露 stroke 渐变编辑;描边仍纯色编辑 + 渐变只读提示);形状**图案**填充编辑未做(工具栏 props 无 pattern)。这两项是后续独立控件。
- 渐变限两停靠点线性(与背景/文字一致)。

**至此:两停靠点线性渐变填充在背景面板、文字工具栏、形状画刷三处都可编辑。**

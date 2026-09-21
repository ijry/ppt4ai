# 渐变文字绘制设计

> 状态：已实现（2026-09-21）
> 日期：2026-09-21

## 1. 目标

让画布真正画出 run 级**渐变文字**。run 渐变填充此前已能导入/往返（`TextMarks.color` 是 `Fill`），但绘制只用第一停靠点的平色（`087cad5` 那刀明确把逐字渐变绘制留为独立切片）。本刀补上绘制。

## 2. 关键决策

**决策 1：场景加 `SceneTextLayoutRun.resolvedFillGradient`，复用形状那套 `resolvedFillGradient`**

run 映射调 `resolvedFillGradient(run.marks?.color, context)`，与形状/背景/单元格同一条「停靠点 < 2 就没有渐变」的规则。`resolvedColor`（第一停靠点）仍是平色后备。

**决策 2：横排绘制把 `fillStyle` 设成 run 框上的 `CanvasGradient`**

canvas 的 `fillText` 直接用当前 `fillStyle` 填充字形，因此设成 run 框（`x, line.y, width·scale, height·scale`）上的 `CanvasGradient`（复用 shape-painting 导出的 `fillGradient`）即可画出真实渐变文字，无需逐字裁剪。放在 `applyTextStyle` 之后、`fillText` 之前；无渐变时保留平色。竖排暂不做（另一套坐标/旋转）。

**决策 3：导入/导出/写回无需改**

`087cad5` 已让 run 渐变进模型并往返，本刀纯渲染层。

## 3. 测试策略（TDD）

- **场景**（`render/text-run-gradient.test.ts`，3 项）：解析渐变 + 平色后备；纯色不产出；停靠点 < 2 退化。
- **绘制**（`editor/text-run-gradient-painting.test.ts`，2 项）：渐变在 run 框上调 `createLinearGradient`、`fillText` 时 `fillStyle` 是 `CanvasGradient`；无渐变画平色。
- **回归**：全量 2427 项。

## 4. 已知限制

- 竖排**直立**字形已画渐变(CJK 常见路径)；竖排**旋转**字形(拉丁字母,在 translate+rotate 变换下绘制)仍画平色——页面空间的渐变轴在旋转坐标里映射不干净,单列。
- 图案文字仍画平前景（图案裁剪到字形是另一独立切片）。
- `a:path` 径向渐变按圆形近似（与形状渐变共用 `fillGradient`）。

# 表格单元格渐变填充设计

> 状态：已实现（2026-09-20）
> 日期：2026-09-20

## 1. 目标

紧接单元格图案填充那刀，把渐变（`a:gradFill`）也画到单元格上。单元格填充改走 `parseDirectFill` 后，渐变已能进模型（`fill.gradient`），但场景与绘制端只认 `resolvedFillColor`，因此单元格声明的渐变被画成第一停靠点的平色。

## 2. 当前状态（实测）

导入侧已通（`parseDirectFill` 认 `gradFill`）。场景 `SceneTableLayoutCell` 只有 `resolvedFillColor`/`resolvedFillPattern`，缺 `resolvedFillGradient`；`paintCellFill` 只画平色矩形。与形状节点同样的渐变早已能画（形状有 `resolvedFillGradient` 与 `fillGradient`）。

## 3. 关键决策

**决策 1：场景加 `SceneTableLayoutCell.resolvedFillGradient`，复用形状那套 `resolvedFillGradient`**

单元格映射调 `resolvedFillGradient(resolvedStyle.fill, context)`，与形状、幻灯片背景同一条「停靠点 < 2 就没有渐变」的规则。`resolvedFillColor`（第一停靠点）仍是平色后备。图片单元格无渐变（图片即填充）。

**决策 2：绘制端导出并复用形状的 `fillGradient`**

`shape-painting.ts` 的 `fillGradient` 从模块私有改为 `export`，`table-painting.ts` 引入它。`paintCellFill` 在平色分支里先判 `resolvedFillGradient`：存在则 `fillStyle` 设成 `fillGradient(context, gradient, mappedBounds)`（轴在映射后的单元格框上算，与形状一致），否则走既有平色。缩略图 worker 走同一个 `paintTableNode`。

**决策 3：写回不需要改**

表格整块从模型重建（`serializeTableXml` → `serializeFillXml`，早已认 `gradient`），因此单元格渐变按模型逐字写出，未编辑逐字节相同。

## 4. 测试策略（TDD，逐层红→绿）

- **场景**（`render/table-cell-gradient.test.ts`，3 项）：直接单元格渐变解析停靠点与平色后备；纯色不产出渐变；停靠点 < 2 退化平色。
- **绘制**（`editor/table-cell-gradient-painting.test.ts`，2 项）：渐变在映射后单元格框上调 `createLinearGradient`、`fillStyle` 变成 `CanvasGradient`；无渐变时只画平色。
- **写回**（`pptx-export/table-cell-gradient-writeback.test.ts`，3 项）：导入为渐变；未编辑逐字节相同；编辑单元格触发重建时按模型写出 `a:gradFill`、不塌成 solidFill。
- **回归**：全量 2383 项。

## 5. 已知限制

- 单元格渐变没有编辑入口（与图案、形状渐变一样，本刀只补读取→解析→绘制→写回，无编辑命令）。
- `a:path` 径向渐变按圆形近似（与形状渐变共用 `fillGradient` 的同款取舍）。
- 单元格内未建模的 `a:extLst` 等在表格触发重建时丢失（表格写回整块重建，非补丁）。

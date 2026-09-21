# 表格自身图案/渐变填充设计

> 状态：已实现（2026-09-21）
> 日期：2026-09-21

## 1. 目标

把表格自身填充（`a:tblPr` 上的 `EG_FillProperties`）的图案与渐变接通。单元格填充改走 `parseDirectFill` 后，表格自身填充仍留在只认 `solidFill` 的 `parseFill`，因此表格级的图案/渐变填充被丢掉或降级成第一色。

## 2. 当前状态（实测）

`importer.ts` 里表格自身填充是 `parseFill(tableProperties ?? table)`（solid-only，且 `parseFill` 走递归 `findDescendants`）。导出侧 `serializeTableXml` 早已用 `serializeFillXml(table.fill)`（认 pattern/gradient）。`SceneTableNode.fill` 存在但**不参与绘制**（`paintTableNode` 只画单元格填充/边框/文本），因此这刀是模型与往返保真，不影响画布。

## 3. 关键决策

**决策 1：表格自身填充改用 `parseDirectFill`，与单元格、形状同一个入口**

`a:tblPr` 承载的是与单元格 `a:tcPr`、形状 `p:spPr` 相同的填充选择，改成 `tableProperties ? parseDirectFill(tableProperties) : undefined`。这同时收敛了作用域：旧的 `parseFill(tableProperties ?? table)` 在没有 `tblPr` 时会递归整张表去找 `solidFill`（可能误取单元格填充），新写法只看 `tblPr` 的直接子节点，语义更准。

**决策 2：绘制与写回不需要改**

`SceneTableNode.fill` 不画（表格背景在 OOXML 里被单元格与网格覆盖，画布只画单元格），因此没有场景/绘制改动。写回随表格整块重建，`serializeFillXml` 已认图案/渐变，逐字写出。

## 4. 测试策略（TDD，逐层红→绿）

- **导入**（`pptx-import/table-own-fill.test.ts`，3 项）：表格 `a:pattFill` 读出预设两色并镜像前景进 `fill.color`；`a:gradFill` 读出停靠点；纯色仍读。
- **写回**（`pptx-export/table-own-fill-writeback.test.ts`，2 项）：未编辑逐字节相同；编辑单元格触发重建时表格 `a:tblPr` 按模型写出 `a:pattFill`。
- **回归**：全量 2388 项。

## 5. 已知限制

- 表格自身填充不参与画布绘制（OOXML 语义如此，单元格与网格覆盖它），本刀只保证模型与往返保真。
- 无编辑入口（与单元格填充一样）。
- 单元格/表格内未建模的 `a:extLst` 在整块重建时丢失（表格写回既有形态）。

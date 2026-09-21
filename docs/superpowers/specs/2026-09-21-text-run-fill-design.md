# 文字 run 渐变/图案填充设计

> 状态：已实现（2026-09-21）
> 日期：2026-09-21

## 1. 目标

让 run 级文字填充的渐变（`a:gradFill`）与图案（`a:pattFill`）进模型并往返。`TextMarks.color` 早已是 `Fill` 类型（能承载 `gradient`/`pattern`），导出 `serializeMarks` 也早已用 `serializeFillXml` 写出，唯独导入只读 `solidFill`，把非纯色文字填充丢掉。

## 2. 当前状态（实测）

`parseRunProperties` 里 `const color = parseColor(child(runProperties, 'solidFill'))` —— 只认纯色。和表格填充修复前同一类问题。场景 `resolvedFillColor(run.marks.color)` 读 `fill.color`，导入端渐变/图案解析器都会把 `color` 设成第一停靠点/前景，所以只要导入进来，平色后备天然可用。

## 3. 关键决策

**决策 1：run 填充改用 `parseDirectFill`**

和表格单元格、表格自身填充同一个修法：`const fill = parseDirectFill(runProperties); if (fill) marks.color = fill`。渐变/图案/纯色三种都进模型。

**决策 2：绘制暂不画渐变/图案文字，保留平色后备**

把渐变裁剪到字形轮廓需要 canvas 的 clip-to-glyph（`fillText` 无法直接用 `CanvasGradient` 逐字裁剪成理想效果），是独立且复杂的绘制切片。本刀只做「读取→模型→往返保真」：绘制继续用 `resolvedColor`（第一停靠点/前景）画平色，和渐变背景接入前形状节点的处理同一纪律。

**决策 3：导出/写回无需改**

`serializeMarks` 已走 `serializeFillXml(marks.color)`，认渐变/图案；写回随 `serializeTextBodyXml` 整体重写。

## 4. 测试策略（TDD）

- **导入**（`pptx-import/text-run-fill.test.ts`，3 项）：渐变读出停靠点+第一停靠点平色；图案读出预设+前景镜像；纯色仍读。
- **写回**（`pptx-export/text-run-fill-writeback.test.ts`，3 项）：导入渐变；未编辑逐字节相同；编辑文本触发重写时写出 `a:gradFill`、不塌成 solidFill。
- **回归**：全量 2409 项。

## 5. 已知限制

- 画布仍以平色（第一停靠点/前景）绘制渐变/图案文字，不做逐字形裁剪的真实渐变/图案 —— 独立绘制切片。
- 无编辑入口。

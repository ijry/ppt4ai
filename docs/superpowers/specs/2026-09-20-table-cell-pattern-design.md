# 表格单元格图案填充设计

> 状态：已实现（2026-09-20）
> 日期：2026-09-20

## 1. 目标

把 `a:pattFill`（以及渐变）接到表格单元格填充上。形状、幻灯片背景早已能解析并画出图案，但单元格填充走的是只认 `solidFill` 的 `parseFill`，因此单元格声明的图案或渐变填充在导入时被整块丢掉，单元格来到画布上没有任何填充。

## 2. 当前状态（实测）

`importer.ts` 里 `parseFill(shape)` 只 `findDescendants(shape, 'solidFill')`，单元格 `a:tcPr` 用它取填充。形状用的是 `parseDirectFill`（认 solid/grad/patt 三选一）。场景 `SceneTableLayoutCell` 只有 `resolvedFillColor`，绘制端 `paintCellFill` 只画平色矩形。

## 3. 关键决策

**决策 1：单元格填充改用 `parseDirectFill`，与形状同一个入口**

`a:tcPr` 承载的是与 `p:spPr` 相同的 `EG_FillProperties` 选择，所以单元格填充理应走同一个解析器。改一行 `parseFill` → `parseDirectFill`，图案/渐变/纯色三种单元格填充都进模型，`Fill.color` 仍承载图案前景（与形状、背景同一纪律）。表格样式区域（`wholeTbl` 等）本就用 `parseDirectFill`（`parseStyleRegion`），不受影响。

**决策 2：场景加 `SceneTableLayoutCell.resolvedFillPattern`**

`documentToSceneGraph` 的单元格映射复用形状那套 `resolvedFillPattern(resolvedStyle.fill, context)`。图案来自单元格自身或表格样式区域（经 `resolveTableCellStyle` 合并后的 `resolvedStyle.fill`），`phClr` 由主题解析。图片单元格仍无图案（图片即填充，与平色同规则）。

**决策 3：绘制端复用形状的 `paintPatternFill`，把单元格矩形当作路径**

`paintCellFill` 在平色分支之前先试图案：存在 `resolvedFillPattern` 时把单元格框拼成矩形路径交给 `paintPatternFill`，图案自画背景色再画前景，**替换**平色。返回 false（预设无几何且无覆盖）时回退平色，与形状、背景一致。缩略图 worker 走同一个 `paintTableNode`，因此无需单独改。

**决策 4：写回不需要改**

表格在写回时是整块从模型重建（`serializeTableXml`），不像形状那样打补丁。`serializeFillXml` 早已认 `pattern`，因此单元格图案在重建时按模型逐字写出；单元格内未建模的 `a:extLst` 会像其它未建模单元格细节一样在重建中丢失（表格写回的既有形态）。

## 4. 测试策略（TDD，逐层红→绿）

- **导入**（`pptx-import/table-cell-pattern.test.ts`，3 项）：读出预设与两色并把前景镜像进 `fill.color`；纯色单元格仍读；无填充仍为 undefined。
- **场景**（`render/table-cell-pattern.test.ts`，4 项）：直接单元格图案解析两色；纯色不产出图案；表格样式经主题 `phClr` 解析出图案；图案存在的保底断言。
- **绘制**（`editor/table-cell-pattern-painting.test.ts`，2 项）：图案裁剪到单元格并画两色、平色不再执行；无图案时只画平色。
- **写回**（`pptx-export/table-cell-pattern-writeback.test.ts`，3 项）：导入为图案；未编辑逐字节相同；编辑单元格触发重建时按模型逐字写出图案、不塌成 solidFill。
- **回归**：全量 2375 项。

## 5. 已知限制

- 单元格图案没有编辑入口（与形状/背景图案一样，图案本身不可创作，只能被纯色替换）。
- 单元格内未建模的 `a:extLst` 在表格触发重建时丢失（表格写回是整块重建，非补丁，这是它的既有形态）。
- `pctNN` 百分比预设在画布上是平滑合成色而非真实网点纹理（与形状图案共用 `paintPatternFill` 的同款取舍）。

# 单元格对角线边框设计

> 状态：已实现（2026-09-04，`5a4fc1e`）
> 日期：2026-09-04

## 1. 目标

让单元格的两条对角线（`a:tcPr/a:lnTlToBr`、`a:lnBlToTr`，以及表格样式里的 `a:tl2br`/`a:tr2bl`）进入模型、画到画布、写回文件。这是内边框那一刀记下的延期项：当时的理由是「绘制端没有画对角线的路径，只建模一半不如不做」—— 读代码后确认那条路径**几乎是现成的**（`borderPoints` 就是一个 side → 两点的函数，`paintCellBorder` 只画一条线段），因此这一刀连绘制一起做完。

对角线单元格在中日韩表格表头里很常见（「项目 \ 月份」那种斜分格），今天读进来是空的。

## 2. 现状（读代码所得）

- `TableCellBorders` 只有四边；`parseTableCellBorders`（`importer.ts:335`）只读 `lnL`/`lnR`/`lnT`/`lnB`
- `parseStyleBorders` 读四边加上一刀新增的 `insideH`/`insideV`，`tl2br`/`tr2bl` 仍不读
- 绘制侧 `borderSides = ['left','right','top','bottom']` 驱动循环，`borderPoints(bounds, side)` 返回线段两端；场景侧 `resolveBorderColors` 同样按这四个键解析颜色
- 导出侧单元格走 `serializeBorders`，样式走 `serializeTableStylesXml`

## 3. 关键决策

**决策 1：模型只用一对名字，取单元格的词汇**

`TableCellBorders` 新增 `tlToBr`/`blToTr`（左上→右下、左下→右上）。表格样式里那两个元素叫 `a:tl2br`/`a:tr2bl`，**映射到同一对模型字段**而不是另起两个名字 —— `resolveTableCellStyle` 本来就是把区域边框解析成「这个单元格的边」，同一个概念两套名字只会多一张翻译表。

**决策 2：样式区域的对角线整块套到区域内每个单元格**

与 `insideH`/`insideV` 不同：内边框描述的是**单元格之间的那条线**，所以要按位置派发；对角线描述的是**单元格自己**，所以区域里每个单元格都得到它。因此 `regionBordersForCell` 对这两个字段是直接拷贝。

**决策 3：绘制就是从角到角的一条线段**

`tlToBr` 是 `(x, y) → (x+w, y+h)`，`blToTr` 是 `(x, y+h) → (x+w, y)`，宽度、线型、颜色与四边共用同一段代码（`borderWidth`/`borderStyle`/`dashPattern`）。两条对角线排在四边**之后**画，因此它们压在边框之上。

**合并单元格自动正确**：场景布局给跨行跨列的单元格的是它合并后的整块矩形，对角线因此横跨整块 —— 这正是「项目 \ 月份」表头想要的效果，不需要额外处理。

**决策 4：`a:lnTlToBr` 与 `a:tl2br` 的 `w`/`prstDash` 走既有解析**

两处都是 `CT_LineProperties`（样式侧再包一层 `a:ln`，与四边同构），所以 `parseTableBorder`/`parseStyleBorder` 一个字都不用改，只需多认两个元素名。

## 4. 契约（增量）

`@ppt4ai/model`：`TableCellBorders` 新增 `tlToBr`/`blToTr`；校验把它们纳入既有的边框校验；`regionBordersForCell` 直接拷贝（决策 2）。

`@ppt4ai/pptx-import`：单元格读 `a:lnTlToBr`/`a:lnBlToTr`，样式读 `a:tl2br`/`a:tr2bl`。

`@ppt4ai/render`：`resolveBorderColors` 解析两个新键。

`@ppt4ai/editor`：`borderSides` 加两项，`borderPoints` 加两条分支。

`@ppt4ai/pptx-export`：单元格写 `a:lnTlToBr`/`a:lnBlToTr`（在四边之后，`CT_TableCellProperties` 的 sequence 顺序），样式写 `a:tl2br`/`a:tr2bl`（在 `insideV` 之后）。

## 5. 测试策略

- **导入**：单元格两条对角线各自进模型（含 `w` 与 `prstDash`）；样式的 `tl2br`/`tr2bl` 进同一对字段
- **解析**：区域声明对角线时，区域内每个单元格都拿到（含中间与四角，与 `insideH` 的按位置派发对照）
- **绘制**：两条线段的端点正确、压在四边之后；`style: 'none'` 与缺颜色时不画
- **导出与往返**：单元格与样式两处都写出并读回；顺序符合 sequence
- **回归**：现有 1765 项

## 6. 已知限制

- 对角线不参与命中测试（边框整体都不参与）
- `a:tcPr` 的 `marL`/`marR`/`anchor` 等其余属性仍不建模
- 仍无阅读器实测

# 表格样式内边框设计

> 状态：设计中（2026-09-04）
> 日期：2026-09-04

## 1. 目标

让表格样式的 `a:insideH`/`a:insideV`（区域内部的横线与竖线）进入模型并影响绘制。这是表格样式那一刀记下的第一条延期：`TableCellBorders` 只有四边，而**真实 Office 样式正是用这两个元素画内部网格线**，因此今天一张套用了 Office 内置风格的表格，内部线条一条都没有。

## 2. 现状（读代码所得）

- `parseStyleBorders`（`importer.ts:542`，上一刀刚改成 ECMA 形状）只找 `left`/`right`/`top`/`bottom` 四个名字，`insideH`/`insideV` 落地即弃
- `TableStyleRegion.borders` 的类型是 `TableCellBorders`，与**单元格自己的**边框共用一个类型；单元格没有「内部」的概念，所以不能直接往那个类型上加字段
- `mergeTableStyleRegion` 把区域的四边**整块拷到每个单元格**上，因此 `wholeTable` 的 `bottom` 今天画在每一行下面 —— 视觉上与「内部横线」难以区分，这正是这个缺口一直没人发现的原因

## 3. 关键决策

**决策 1：新增 `TableStyleBorders`，不动 `TableCellBorders`**

```ts
export interface TableStyleBorders extends TableCellBorders {
  /** `a:insideH`：区域内部的横线，落在非首行单元格的上边与非末行单元格的下边。 */
  insideH?: TableBorder
  /** `a:insideV`：区域内部的竖线，落在非首列单元格的左边与非末列单元格的右边。 */
  insideV?: TableBorder
}
```

单元格边框与样式区域边框从此是两个类型：单元格没有「内部」，让它能声明 `insideH` 是让模型能表达无意义的东西。`TableStyleRegion.borders` 改用新类型，`ResolvedTableCellStyle.borders` 仍是四边的 `TableCellBorders` —— 解析的产物永远是「这个单元格的四条边」。

**决策 2：内边框在内部边上胜过区域的外边框，因此这一刀是严格增量的**

同一个区域同时声明 `bottom` 与 `insideH` 时，非末行单元格的下边取 `insideH`，末行取 `bottom`。理由：**这是让两个元素都有意义的唯一读法** —— 如果 `bottom` 的意思本就是「每个单元格的下边」，`insideH` 就永远是多余的。

**没有声明 `insideH`/`insideV` 的样式行为完全不变**，因此既有测试（`model.test.ts:402`、`scene.test.ts` 都钉着 `wholeTable.bottom` 出现在首行单元格上）一条都不用改。

**决策 3：「区域外边框只画在区域外沿」这条不在本刀里改**

按同一条读法推下去，`wholeTable` 的 `top` 本应只画在表格最上沿，而今天画在每个单元格上。但那是**改变既有行为**，判据只有我对 schema 元素名的读法，本机又没有阅读器可实测 —— 按仓库既定纪律（对其他应用行为的断言一律标注不确定），这条记为**待阅读器核对项**，不在这一刀里动。本刀只做增量部分。

**决策 4：位置判断用网格坐标，与既有的 `firstRow`/`lastRow` 判断同一套**

`row === 0`、`row === table.rows.length - 1`、`column === 0`、`column === table.columns.length - 1` —— 与 `resolveTableCellStyle` 里已有的四个判断逐字一致。合并单元格的跨行跨列不参与判断（既有代码也不参与），记为已知限制。

**决策 5：对角线 `tl2br`/`tr2bl` 仍不建模**

单元格自己的对角线（`a:lnTlToBr`/`a:lnBlToTr`）也不建模，绘制端没有画对角线的路径。只建模一半（读进来画不出）不如不做。

## 4. 契约（增量）

`@ppt4ai/model`：新增 `TableStyleBorders`；`TableStyleRegion.borders` 改用它；`resolveTableCellStyle` 按单元格位置把内边框派到四边；校验接受两个新键。

`@ppt4ai/pptx-import`：`parseStyleBorders` 读 `a:insideH`/`a:insideV`（仅 ECMA 形状，扁平写法没有对应元素）。

`@ppt4ai/pptx-export`：`serializeTableStylesXml` 按 `CT_TableCellBorderStyle` 的 sequence 写出（left → right → top → bottom → insideH → insideV）。

渲染与编辑器不动：`ResolvedTableCellStyle.borders` 的形状没变，绘制端拿到的仍是四条边。

## 5. 测试策略

- **解析**：3×3 表格，`wholeTable` 只声明 `insideH`/`insideV` → 中间单元格四边都有、四角单元格只有朝内的两边
- **优先级**：同时声明 `bottom` 与 `insideH` → 非末行取 `insideH`、末行取 `bottom`（决策 2）
- **不回归**：只声明四边的样式，解析结果与改动前逐字相同
- **导入**：两个新元素进模型，`a:ln` 里的 `w`/`prstDash` 同样生效
- **导出**：按 sequence 顺序写出；往返原样回来
- **回归**：现有 1727 项

## 6. 已知限制

- 「区域外边框只画在外沿」仍未改（决策 3）—— **待阅读器核对**
- 合并单元格的跨行跨列不参与位置判断（决策 4）
- 对角线两个元素仍不建模（决策 5）
- 内置样式仍解析不了（表格样式那一刀的限制，未变）
- 仍无阅读器实测

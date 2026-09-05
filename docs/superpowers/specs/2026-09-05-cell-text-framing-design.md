# 单元格文本边距与锚定设计

> 状态：已实现（2026-09-05，`be1420a`）
> 日期：2026-09-05

## 1. 目标

让单元格文本的四边留白（`a:tcPr/@marL`/`@marR`/`@marT`/`@marB`）与垂直锚定（`@anchor`）进入模型、画到画布、写回文件。今天这五个属性整块丢失，所有单元格的文本紧贴左上角绘制，即便 Office 文档明确声明居中或加了 0.1 英寸边距。

OOXML 把这些属性放在 `a:tcPr` 上，而不是单元格 `a:txBody/a:bodyPr`，但它们的作用域与 `bodyPr` 完全一样 —— 边距推动文本块内缩，锚定把那个块放到内缩后矩形的顶部/中部/底部。因此模型把它们记为同一个 `TextBodyProperties` 接口，只是分两个字段持有。

## 2. 现状（读代码所得）

- `TableCell` 有 `body: TextBody`，后者带 `bodyPr?: TextBodyProperties`，对应 `a:txBody/a:bodyPr`；`a:tcPr` 的属性今天无处可去
- `importer.ts:335` `parseTableCellBorders` 只读边框，`a:tcPr` 的其余属性（边距、锚定、文字方向等）整块跳过
- 场景侧 `scenegraph.ts:460` `textBodyLayoutInfo` 把 `body.bodyPr` 的 `insets`/`verticalAlign` 交给布局，已有的代码路径完整，只是没有数据喂给它
- 导出侧 `table.ts:136` `serializeCellBodyXml` 写 `a:txBody`，但从未写过 `a:tcPr`

## 3. 关键决策

**决策 1：模型字段复用 `TextBodyProperties`，但只有边距与锚定生效**

```ts
export interface TableCell {
  body: TextBody
  cellBodyPr?: TextBodyProperties  // 仅 insets 与 verticalAlign 有效
  // ...
}
```

`TextBodyProperties` 有九个字段（`insets`、`verticalAlign`、`autofit`、`wrap`、`columns`、`rotation`、`fromWordArt`、`upright`、`anchor`），但后六个在 OOXML 里都住在 `a:bodyPr` 内，`a:tcPr` 只有前两个的对应物。因此导入与导出都**只认边距与锚定**，其余字段出现在 `cellBodyPr` 时被静默过滤 —— 拒绝它们不如让文件原样回写。

**决策 2：场景把 `cellBodyPr` 与 `body.bodyPr` 合并，后者优先**

场景侧新增 `cellBodyPr` 字段（而不是把两者合并后只保留一个），原因是布局需要知道**哪个属性是哪里说的**：

- 边距与锚定来自 `cellBodyPr` → 写回 `a:tcPr`
- 边距与锚定来自 `body.bodyPr` → 写回 `a:txBody/a:bodyPr`

合并规则：`body.bodyPr` 声明的值优先（它是更具体的那个），缺席时取 `cellBodyPr`。这与「形状 `bodyPr` 优先于占位符继承的默认 `bodyPr`」同一条合并规则。

**决策 3：边距进口是「全有或全无」，出口按字段写**

`parseBodyProperties` 已有的规则是：四个边距都有才返回 `insets`，否则返回 `undefined`（模型没有「部分边距」的形态）。这条规则原样用于 `cellBodyPr`，所以一个单元格只声明 `marL` 时，模型记不下来 —— 与今天 `a:bodyPr` 的处理一致。

导出侧写每个模型声明的属性，因此 `insets: {left: 0}` 只写 `marL="0"`，不写其余三个 —— Office 对缺席属性有自己的默认值（`marL`/`marR` 91440，`marT`/`marB` 45720），由阅读器补。

**决策 4：不在导入或解析时套用 Office 的属性默认值**

Office 规定单元格缺 `marL` 时按 91440 EMU（0.1 英寸）算。这一刀**不**在导入/解析时把那个默认值填进模型，理由有二：

1. **会移动画布上每个表格的文本**，因为现有文档里绝大多数单元格都不声明边距，套用默认值后文本全部内缩
2. **手搭文档的 `marL="0"` 会被覆盖成 91440**，违反「原样保留文件能表达的」原则

因此模型与导入都不管这个默认值；布局侧也不管（`layoutText` 缺 `insets` 时按 0 算）。结果是：今天画布上紧贴边框的文本在这一刀之后**仍然紧贴**，除非源文件明确声明了边距。

这条是**刻意的不完整**，记为待决策项而非已知缺陷：如果阅读器核对后确认 Office 确实用那套默认值，且用户反馈表格文本贴边是 bug，那时再加 —— 一行 `?? {left: 91440, right: 91440, top: 45720, bottom: 45720}`，但那是行为变更。

**决策 5：`@anchor` 的三个词直接映射，缺席时不记录**

`t` → `'top'`，`ctr` → `'middle'`，`b` → `'bottom'`，缺席 → `undefined`。布局已有的默认是顶部对齐，所以缺席 `@anchor` 的单元格在这一刀前后画到同一个位置。

## 4. 契约（增量）

`@ppt4ai/model`：`TableCell` 新增 `cellBodyPr?: TextBodyProperties`；校验接受该字段且只校验 `insets` 与 `verticalAlign`。

`@ppt4ai/pptx-import`：`parseTableCellProperties` 读 `a:tcPr/@marL`/`@marR`/`@marT`/`@marB`/`@anchor`，复用 `parseBodyProperties` 的边距解析，映射锚定词。

`@ppt4ai/render`：场景节点新增 `cellBodyPr`；`textBodyLayoutInfo` 在合并 `cellBodyPr` 与 `body.bodyPr` 后把 `insets` 与 `verticalAlign` 交给布局。

`@ppt4ai/editor`：布局与绘制无改动（已有路径完整）。

`@ppt4ai/pptx-export`：`table.ts` 新增 `serializeTableCellPropertiesXml`，写 `a:tcPr` 及其五个属性；`serializeCellBodyXml` 在写 `a:txBody` 之前先写 `a:tcPr`（符合 `CT_TableCell` 的 sequence）。

## 5. 测试策略

- **导入**：`a:tcPr` 的四边距与锚定进 `cellBodyPr`；`a:bodyPr` 的边距进 `body.bodyPr`，两者不混
- **场景**：`cellBodyPr` 与 `body.bodyPr` 合并时后者优先；缺 `cellBodyPr` 时行为与之前一致
- **布局**：锚定 `ctr` 的单元格文本块纵向居中；锚定 `b` 的块贴底；边距把文本推离边框
- **导出与往返**：三个锚定词与四边距写出并读回；缺 `cellBodyPr` 时不写 `a:tcPr`
- **回归**：现有 1776 项

## 6. 已知限制

- 不套用 Office 属性默认值（决策 4），记为待决策项
- `a:tcPr` 的其余属性（`@vert`、`@horzOverflow` 等）仍不建模
- 表格样式的单元格属性（`a:tcStyle` 里的 `a:tcPr`）仍不建模
- 仍无阅读器实测

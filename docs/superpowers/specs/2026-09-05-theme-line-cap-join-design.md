# 主题线条端点与转角设计

> 状态：待实现
> 日期：2026-09-05

## 1. 目标

让 `a:lnStyleLst` 条目的 `a:ln/@cap` 与转角元素（`a:round`/`a:bevel`/`a:miter`）进入模型、影响画布、写回文件。今天元素侧的 `cap`/`join` **已经建模并绘制**（`6888114`），但主题侧仍不建模 —— 形状只通过 `<p:style><a:lnRef>` 引用线条样式时，拿到的只有 `width` 与 `style`（线宽与虚线型），端点与转角形态丢失。

这与 `fillRef`/`lnRef` 条目已建模的 `width`/`style` 同质：都是 `CT_LineProperties` 的一部分，元素侧与主题侧应当对称支持。

## 2. 现状（读代码所得）

- **元素侧已完整**：`ShapeElement.stroke{Cap,Join}` 与 `TextElement.stroke{Cap,Join}` 存在（`model/index.ts:465,519`），`parseStrokeCap`/`parseStrokeJoin` 会解析 `a:ln/@cap` 与 `a:round|bevel|miter`（`importer.ts:538,544`），场景图的 `createShapeNode`/`createTextNode` 透传到节点上（`scenegraph.ts:253,289`），绘制侧 `paintShapeNode`/`paintTextNode` 读取并设置 `context.lineCap`/`lineJoin`（`shape-painting.ts:37,39` / `text-painting.ts:87,89`），导出侧 `serializeShapeXml`/`serializeTextBodyXml` 写出（`shape.ts:78` / `text-xml.ts:77`）
- **主题侧缺口**：`ThemeLineStyle` 只有 `width`/`style` 而无 `cap`/`join`（`model/index.ts:144`），导入端 `parseThemeLineStyleEntries` 只读颜色与线宽线型（`importer.ts:228`），场景图的 `shapeStroke` 只从主题条目取 `width`/`style`（`scenegraph.ts:360`），导出侧 `serializeFmtScheme` 也只写这两者（`theme.ts:33`）
- **元素与主题的合并点在 `shapeStroke`**：它的签名是 `(element, context) => { width?, style? }`，`element.strokeWidth ?? themeLine?.width`、`element.strokeStyle ?? themeLine?.style` 逐属性回退，`cap`/`join` 如果加到主题也会走同一条路（`scenegraph.ts:356`）

## 3. 关键决策

**决策 1：`ThemeLineStyle` 新增 `cap`/`join` 可选字段，透传到场景节点**

```ts
export interface ThemeLineStyle extends Fill {
  width?: number
  style?: StrokeStyle
  cap?: StrokeCap      // 新增
  join?: StrokeJoin    // 新增
}
```

`shapeStroke` 返回值扩展为 `{ width?, style?, cap?, join? }`，逐属性回退：`element.strokeCap ?? themeLine?.cap`、`element.strokeJoin ?? themeLine?.join`。场景节点的 `stroke{Cap,Join}` 本已存在，因此绘制侧零改动。

**决策 2：转角元素只读第一个认识的子元素**

`a:ln` 的 sequence 允许同时出现 `a:round`、`a:bevel`、`a:miter`，但语义上三者互斥 —— 一条线段的转角只能是一种形态。`parseStrokeJoin` 已是这样实现的：遍历子元素，第一个匹配 `strokeJoins` 集合的名字被返回，后续的忽略（`importer.ts:544`）。

主题侧解析复用同一个函数，因此行为一致。

**决策 3：导出侧写在 `w`/`prstDash` 之后、`solidFill` 之前**

`CT_LineProperties` 的 sequence 是 `(noFill|solidFill|gradFill|...)` → `(prstDash|custDash)` → `(round|bevel|miter)` → `cap` → `...`。转角元素排在虚线型之后、端点属性之前。

`serializeFmtScheme` 当前写 `a:ln`（含 `w`/`prstDash`/`solidFill`/`gradFill`），新增在 `solidFill`/`gradFill` 之前插入转角元素与 `cap` 属性 —— 这样 `prstDash` → 转角 → `cap` → 填充的顺序符合 sequence。

**决策 4：校验接受三个 `cap` 词与三个 `join` 词，不限制共存**

虽然元素实际只会有一个转角，模型允许 `cap` 与 `join` 同时存在 —— 与「允许 `angle` 与 `path` 同时存在」同理，校验拒绝合法数据不如让解析有确定的优先级（`join` 先于 `cap`，因为在 sequence 里排得更前）。

## 4. 契约（增量）

`@ppt4ai/model`：`ThemeLineStyle` 新增 `cap`/`join`；`shapeStroke` 返回值扩展并逐属性回退；校验接受三个 `StrokeCap` 词与三个 `StrokeJoin` 词。

`@ppt4ai/pptx-import`：`parseThemeLineStyleEntries` 调用既有 `parseStrokeCap`/`parseStrokeJoin` 读取。

`@ppt4ai/render`：`shapeStroke` 扩展返回值，场景节点字段本已存在。

`@ppt4ai/pptx-export`：`serializeFmtScheme` 在 `solidFill` 前写转角元素与 `cap` 属性。

## 5. 测试策略

- **导入**：主题 `a:ln` 含 `cap` 与 `a:round` 进 `ThemeLineStyle`；三个 `cap` 词与三个 `join` 词各自往返；同时有两个转角元素时取第一个
- **解析**：只通过 `lnRef` 引用主题线条的形状，其场景节点拿到 `cap`/`join`；元素自己声明的胜过主题
- **绘制**：端点形态与转角形态影响 canvas（复用既有 `shape-painting.test.ts` / `text-painting.test.ts` 的断言结构）
- **导出与往返**：`cap` 属性与转角元素写在 `prstDash` 之后、`solidFill` 之前；未编辑源包逐字节不变
- **回归**：现有 1789 项

## 6. 已知限制

- `a:ln/@cmpd`（复合线）与 `@algn`（对齐）仍不建模，元素侧与主题侧都不支持
- `a:custDash` 仍不建模
- 仍无阅读器实测

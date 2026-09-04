# 独立导出占位符默认值设计

> 状态：设计中（2026-09-04）
> 日期：2026-09-04

## 1. 目标

把母版与版式的 `defaults`（`Record<string, ElementDefaults>`）写成带 `p:ph` 的 `p:sp`。上一刀（`89ea2be`）已经把颜色映射、母版背景与 `p:txStyles` 写出去了，`defaults` 是那张探针表上**仅剩的两项**（母版一份、版式一份），也是往返之后**画布仍会变样**的最后一处继承数据 —— `resolveInheritedElement` 消费它，模型里有、文件里没有。

## 2. 现状

- `parseDefaults`（`importer.ts:1519`）按 `p:ph` 的 `type`/`idx` 组成键（`'title'` 或 `'title:2'`，与元素自己的 `placeholder` 同一种写法），读 bounds、rotation、preset、fill、stroke、body、listStyle 与旧的扁平 `text`
- 母版与版式的 `p:spTree` 在导出里都是空的，因此这些条目一个都不写
- 上一刀之后**文本继承链已经通了一半**：母版 `p:txStyles` 会写出，所以「标题 44pt」这类最常见的继承已经能过往返；`defaults` 里剩下的是**版式对某个占位符的覆盖**（自己的位置、自己的 `a:lstStyle`、自己的填充）

## 3. 关键决策

**决策 1：占位符形状用专门的序列化函数，不复用 `serializeShapeXml`**

`serializeShapeXml` 的两个分支都不合用：`kind: 'text'` 会写 `txBox="1"`（占位符不是文本框），`kind: 'shape'` 根本不写 `p:txBody`（占位符要写，`a:lstStyle` 就挂在那里）。硬塞一个合成元素进去要传一个假的 `kind`，比写一个 20 行的专用函数更难读。**但底层助手全部复用** —— `serializePlaceholder`、`serializeTransformContents`、`serializeGeometry`、`serializeFillXml`、`serializeTextBodyXml` 一个都不重写。

**决策 2：`a:lstStyle` 由 `serializeTextBodyXml` 填**

那个空的 `<a:lstStyle/>` 本来就是它写的，因此加一个可选参数由它填层级默认值，而不是在占位符那边另拼一份 `p:txBody`。层级默认值本身走上一刀已经加好的 `serializeLevelDefaultsXml`。

**决策 3：键按字典序写出**

`defaults` 是 `Record`，`Object.keys` 是插入序。导出必须对「结构相同的两份文档」产出相同字节（既有的确定性测试钉着这条），所以按键排序遍历。

**决策 4：版式有占位符时 `type` 从 `blank` 改成 `cust`**

带标题占位符的版式不是 blank。模型不存版式类型（`ST_SlideLayoutType` 的十几个词一个都没建模），`cust`（自定义）是唯一不撒谎的选择。**没有占位符时仍写 `blank`** —— 上一刀刚钉下「无母版文档导出结果逐字节不变」，这条继续成立。

**决策 5：`text` 与 `body` 同时存在时只写 `body`**

`parseDefaults` 会同时填 `body` 与旧的扁平 `text`（后者供写回路径比较）。写出时以 `body` 为准，`text` 只在没有 `body` 时包成单段单 run —— 与 `serializeShapeXml` 对元素的处理同一条规则。导入端会从写出的 body 重新派生 `text`，因此往返一致。

## 4. 契约（增量）

`@ppt4ai/pptx-export`：

- `text-xml.ts`：`serializeTextBodyXml(body, prefix?, listStyle?)`
- `standalone-xml.ts`：新增占位符形状序列化；`serializeMasterXml`/`serializeLayoutXml` 把 `defaults` 写进各自的 `p:spTree`

模型、导入、渲染不动。

## 5. 测试策略

- **母版**：每个 `defaults` 条目一个 `p:sp`，`p:ph` 的 `type`/`idx` 来自键；bounds、rotation、preset、fill、stroke 各自写出
- **版式**：同上，且 `type="cust"`；无 `defaults` 时仍是 `type="blank"` 且 `p:spTree` 为空
- **`a:lstStyle`**：占位符的 `listStyle` 写进 `p:txBody`，层级升序
- **确定性**：键序不同、内容相同的两份文档导出字节相同
- **往返**：母版与版式的 `defaults` 全部回来（键、bounds、preset、fill、body、listStyle）
- **回归**：现有 1705 项，含上一刀的「无母版逐字节不变」

## 6. 已知限制

- 多母版/多版式仍塌成一个部件（上一刀的限制①，仍是下一刀）
- `ST_SlideLayoutType` 不建模，因此版式类型只能是 `cust`/`blank`（决策 4）
- `a:spLocks`、`p:ph` 的 `orient`/`sz`、母版的 `p:hf` 仍不建模
- 仍无阅读器实测

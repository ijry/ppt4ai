# 独立导出 `p:grpSp` 设计

> 状态：设计中（2026-09-04）
> 日期：2026-09-04

## 1. 目标

让 `createPptx`（无源包的独立导出）写出分组。今天它遇到 `kind: 'group'` **不是把组拍平，而是整份文档导不出去**（`standalone.ts:54`，拒绝由 `standalone.test.ts:651` 钉住）。模型的五种 element kind 里 shape/text/table/image 四种都能独立导出，group 是唯一的空洞 —— 而编辑器的 group 命令本就能造出组（`engine/src/index.ts:1112`），导入器也能把 `p:grpSp` 读成组，所以这个空洞是「模型能表达、编辑器能造、导出写不出」。

## 2. 现状（读代码所得）

- **拒绝点**：`validateElementKinds` 只放过四种 kind，第五种直接抛 `PPTX generation unsupported element kind: group`。
- **两个 group 生产者对 `slide.elementIds` 的约定不同**：
  - 导入器：组与子元素**都**进 `elementIds`，组排在子元素之前（`importer.ts:1684`）
  - 编辑器 group 命令：子元素从 `elementIds` **移除**，只留组（`engine/src/index.ts:1124`）
  - 渲染器用一个 `visited` 集合同时容纳两者（`scenegraph.ts:634`/`642`/`684`）
- **资产收集只走 `slide.elementIds`**（`slideAssetReferences`），因此编辑器造的组里的照片根本不会被物化。
- **写回路径不受影响**：组在源包写回里只占一个槽位、只改 `grpSpPr`（`writeback.ts:1098`），与独立导出是两条路。
- **本包暂无仓内消费者**：`@ppt4ai/pptx-export` 只被自己的测试引用（无导出 UI），所以这是库级空洞而非今天用户能撞到的 bug。

## 3. 关键决策

**决策 1：遍历规则与渲染器逐字一致**

按 `slide.elementIds` 顺序走，遇组递归展开子元素，`visited` 去重。理由是 §2 那两套约定：渲染器已经用这条规则同时容纳两者，导出若另立一套，同一份文档的画布与文件会不一致（谁被画、以什么 z 序）。副作用也一并继承：子元素若排在自己的组**之前**，它以顶层元素身份先被写出、组内不再包含它 —— 与画布上看到的完全一样。这正是进度.md 第 57 行记下的「组必须排在子元素之前」，导出侧从此与渲染侧共用同一条约束。

**决策 2：模型没有 `childSpace` 时写恒等 `a:chOff`/`a:chExt`**

`p:grpSp` 的子元素 `a:off` 是在子坐标空间里的，而模型缺 `childSpace` 的含义是「子元素就是幻灯片绝对坐标」（渲染端 `applyChildSpaces` 对缺失的 childSpace 走恒等）。OOXML 里表达这句话的方式就是 `chOff = off`、`chExt = ext`。**不省略这对**：省略后阅读器如何解释没有定义，而本机无阅读器可实测，所以选能被任何阅读器无歧义读懂的写法。恒等值不是发明数值 —— 它由 `bounds` 推出。

代价明确记下、不藏：往返后模型会**多出一个 `childSpace`**（等于 bounds），因为导入器对恒等子空间也照记（`group-child-space.test.ts:60`）。语义无差 —— `mapChildSpace` 在 `childSpace === target` 时是恒等映射（`geometry/src/index.ts:142`）。这条差异由往返测试显式断言，而不是让它悄悄存在。

**决策 3：`p:cNvPr/@id` 在整棵树上唯一**

今天 `nextShapeId` 是顶层循环里的 `let`，只保证顶层唯一。改成随递归共享的游标：`@id` 的唯一性域是整张幻灯片，嵌套元素同样在域内。

**决策 4：物化与序列化走同一条遍历**

资产收集也递归进 `childIds`，否则组里的照片拿不到关系（`relationshipFor` 会抛 `asset materialization missing`）。这与文件里既有的原则同源：一个函数决定谁需要媒体，物化与序列化不可能各说各话。

**决策 5：不支持的 kind 仍抛错，但要递归查**

组的子元素若是未建模的 kind，必须报错而不是被静默丢掉 —— 静默丢掉会让一张幻灯片少画一个元素而没人知道。

## 4. 契约（增量）

`@ppt4ai/pptx-export`：

- 新增 `serializeGroupXml(group, shapeId, children)`：`p:nvGrpSpPr` + `p:grpSpPr/a:xfrm`（`rot`/`flipH`/`flipV` 属性，`a:off`/`a:ext`/`a:chOff`/`a:chExt` 四个子元素）+ 子元素 XML 串联
- `validateElementKinds` 接受 group 并递归进 `childIds`
- `slideAssetReferences` 递归进 `childIds`
- `serializeSlideElements` 递归 + 共享 shape id 游标 + `visited` 去重

其余包不动：模型、导入、渲染、编辑器都已支持组，这一刀只补导出。

## 5. 测试策略

- **组本身**：`a:off`/`a:ext` 来自 bounds；`rot`/`flipH`/`flipV` 只在设置时写出
- **子空间**：无 `childSpace` 时 `chOff`/`chExt` 等于 `off`/`ext`（决策 2）；有 `childSpace` 时逐字写出
- **嵌套**：组里的组；`p:cNvPr/@id` 全树不重复（决策 3）
- **两种 `elementIds` 约定**各导出一次，子元素都只写出一份（决策 1）
- **组里的照片**：媒体部件、幻灯片关系、`a:blipFill` 三者齐全（决策 4）
- **组里的表格与图片**：各写出 `p:graphicFrame` 与 `p:pic`
- **未建模 kind**：仍抛 `unsupported element kind`（改写现有拒绝测试，决策 5）
- **往返**：分组文档过 `createPptx` → `importPptx`，组结构、旋转、翻转、嵌套都回来，并显式断言决策 2 的 `childSpace` 差异
- **回归**：现有 1676 项

## 6. 已知限制

- **空组不往返**：`childIds: []` 的组会被写出，但导入器丢掉无子元素的组（`importer.ts:1776`）。模型允许空组，编辑器造不出（group 命令要求选中 ≥2 个）
- `p:grpSpPr` 的填充与描边（`CT_GroupShapeProperties` 允许）仍不建模，写出的 `p:grpSpPr` 只有变换
- `p:cxnSp`（连接符）仍不是模型里的 kind，组里也就写不出来
- 阅读器实测仍缺（本机无 PowerPoint/LibreOffice），全部结论来自单测与门禁

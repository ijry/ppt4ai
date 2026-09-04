# 独立导出多母版与多版式设计

> 状态：设计中（2026-09-04）
> 日期：2026-09-04

## 1. 目标

让独立导出的包结构容纳模型里的**全部**母版与版式，而不是把它们塌成一对。这是「幻灯片之上那一层」剩下的两条限制里的第一条（另一条是母版/版式的图片背景），也是前三刀反复点名的那条：颜色映射、背景、`p:txStyles`、占位符默认值现在都写得出，但只写进**一份** `slideMaster1.xml` 与**一份** `slideLayout1.xml`，于是一份有三个版式的文档里，两个版式的内容凭空消失，所有幻灯片都指向同一个版式。

## 2. 现状

- `skeletonEntries` 写死一份母版、一份版式、一份主题；母版/版式内容取「排序后第一个」（上一刀的决策 2）
- 每张幻灯片的关系文件 `rId1` 都指向 `slideLayout1.xml`
- 导入端**顺着关系链发现**母版与版式（`importer.ts:1635-1670`：幻灯片 → 版式 → 母版 → 主题），因此没有幻灯片指向的版式不会被读回来
- 顺带发现一处既有缺陷：`p:sldMasterId/@id` 与 `p:sldLayoutId/@id` 现在写的是 `id="1"`，而 `ST_SlideMasterId`/`ST_SlideLayoutId` 在 schema 里要求 **≥ 2147483648**（`p:sldId/@id` 的 `ST_SlideId` 才是 256..2147483647，那处写的 `256+index` 是对的）

## 3. 关键决策

**决策 1：部件序号来自模型 id 的字典序**

`masters` 排序后依次是 `slideMaster1..N.xml`，`layouts` 排序后依次是 `slideLayout1..M.xml`。与插入序无关，因此「结构相同的两份文档」仍产出相同字节。模型一个母版都没有时仍写一份空母版与一份空版式（版式必须属于某个母版），这保住了既有行为。

**决策 2：版式归属由 `masterId` 决定，认不出的归第一个母版**

母版的 `p:sldLayoutIdLst` 列出属于它的那些版式。**一个版式都没有的母版不写 `p:sldLayoutIdLst`**（该元素在 `CT_SlideMaster` 里可选）—— 不发明一个版式塞给它。真实导入的模型里每个母版都带版式，这是边角情形。

**决策 3：每个母版名下的主题各写一份部件**

`themes` 里被母版引用到的、去重后的主题依次是 `theme1..K.xml`，每个母版的关系文件指向自己那份。没有母版声明主题时仍只写一份（取 `effectiveTheme`），与改动前一致。`presentation.xml.rels` 自己的主题关系指向 `theme1.xml`。这样每个母版的颜色/字体/格式方案都能独立往返 —— 导入端正是顺着母版的关系找主题的。

**决策 4：修掉 `sldMasterId`/`sldLayoutId` 的取值范围**

改成 `2147483648 + index`。这一刀本来就要重写这两张列表，顺手修掉比留着一处 schema 违规更划算。**这会改变没有母版的文档的导出字节**（上一刀刚钉的「逐字节不变」到此为止），因此在记录里点名：那条不变量的用途是「上一刀没碰既有行为」，不是「永远不许变」。

**决策 5：关系编号让单母版包保持原样**

`presentation.xml.rels`：母版 `rId1..N`、主题 `rId(N+1)`、幻灯片依次、`tableStyles` 最后。母版自己的关系文件：版式 `rId1..k`、主题 `rId(k+1)`。N=1、k=1 时与改动前逐字相同，因此既有测试对 `rId2`/`rId3`/`rId4` 的断言全部继续成立。

**决策 6：幻灯片指向自己的版式**

`slide.layoutId` 命名的那一份；没有时取它自己母版名下的第一个版式，再没有就是 `slideLayout1.xml`。上一刀已经按「幻灯片自己声明的母版/版式」算颜色映射，这一刀让关系与它一致。

## 4. 契约（增量）

`@ppt4ai/pptx-export`：

- `serializePresentationXml(page, slideCount, masterCount)`：`sldMasterIdLst` N 条、幻灯片 `r:id` 顺移
- `serializePresentationRelationshipsXml(...)`：N 个母版 + 主题 + 幻灯片 + 可选 tableStyles
- `serializeMasterRelationshipsXml(layoutNumbers, themeNumber)`、`serializeLayoutRelationshipsXml(masterNumber)`、`serializeSlideRelationshipsXml(imageRelationships, layoutNumber)`
- `serializeMasterXml(master?, colorMap, layoutNumbers)`：`p:sldLayoutIdLst` 按归属
- `serializeContentTypesXml(...)`：按数量写 override
- `standalone.ts`：把母版、版式、主题三张表与「幻灯片 → 版式」的映射算出来传下去

模型、导入、渲染不动。

## 5. 测试策略

- **结构**：两个母版、三个版式、三张幻灯片 → 部件齐全、`sldMasterIdLst` 两条且 id 从 2147483648 起、各母版的 `sldLayoutIdLst` 只列自己的版式、各幻灯片的 `rId1` 指向自己的版式
- **主题**：两个母版引用两个主题 → 两份 theme 部件，各母版关系文件各指一份
- **单母版**：关系编号与改动前一致（`rId1` 母版、`rId2` 主题、`rId3` 幻灯片）
- **未被引用的版式**：仍写出部件（导入端读不回来是它的规则，不是导出的错）
- **确定性**：键序不同、内容相同 → 字节相同
- **往返**：两个母版各自的颜色映射、背景、`textStyles`、占位符默认值都回来；两张幻灯片各自保留自己的 `layoutId`/`masterId`；两个主题分别回来
- **回归**：现有 1711 项

## 6. 已知限制

- 母版/版式的**图片背景**仍写不出（幻灯片之上那一层最后一条）
- 一个版式都没有的母版不写 `p:sldLayoutIdLst`（决策 2）
- 母版之间共享同一个主题时仍写成一份部件（决策 3 按去重后的主题算，不按母版数）
- `p:hf`、`p:transition`、`p:timing`、`ST_SlideLayoutType`、`a:spLocks` 仍不建模
- 仍无阅读器实测

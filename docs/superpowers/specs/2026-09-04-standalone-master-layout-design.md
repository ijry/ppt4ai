# 独立导出母版与版式设计

> 状态：已实现（2026-09-04，`89ea2be`）
> 日期：2026-09-04

## 1. 目标

让独立导出把**幻灯片之上那一层**写出去。今天 `createPptx` 只从模型取主题，母版与版式一律写死成空骨架，因此颜色映射、母版/版式背景、母版文字样式全部丢失 —— 而这三样每一样都改变每一张幻灯片的呈现。

## 2. 探针结果（实测，`inheritance-probe.test.ts`，已删除）

手搭一份带母版、版式、三级颜色映射与 `p:txStyles` 的文档，`createPptx` → `importPptx` 后逐项比对：

| 模型里的事实 | 往返之后 |
|---|---|
| 幻灯片 `colorMapOverride` `{tx1:accent1, bg1:accent2}` | **null** |
| 母版 `colorMap` `{tx1:dk2, bg1:lt2}` | **被换成默认恒等映射**（`tx1:dk1`、`bg1:lt1`） |
| 母版 `background` | **null** |
| 母版 `textStyles`（title 44pt 粗体） | **null** |
| 母版 `defaults` | `{}` |
| 版式 `background` | **null** |
| 版式 `colorMapOverride` | **null** |
| 版式 `defaults` | `{}` |
| 幻灯片 `layoutId`、元素 `placeholder` | 保留（结构在） |

**最坏的一条是母版颜色映射被静默换成恒等映射**：幻灯片里写 `tx1` 而母版把 `tx1` 映到 `dk2` 时，往返前后是两种颜色，而且没有任何报错。这不是「少写了一个可选属性」，是**写出了一份说着别的意思的文件**。

## 3. 关键决策

**决策 1：颜色映射三层都写，写出去的是合并后的完整 12 槽**

`a:overrideClrMapping`（`CT_ColorMapping`）的 12 个属性在 schema 里都是必需的，而模型的覆盖是 `Partial<ColorMap>`（语义是「只覆盖这几个、其余继承」）。因此写出前先用模型自己的 `mergeColorMaps` 把 母版 ← 版式覆盖 ← 幻灯片覆盖 合成完整映射，再写。**代价**：往返后模型里的覆盖从 2 个槽变成 12 个槽 —— 合并结果不变（`mergeColorMaps` 对完整覆盖与部分覆盖给出同一张有效映射），由往返测试显式断言。模型没有覆盖时仍写 `<a:masterClrMapping/>`，即「继承」。

**决策 2：母版与版式各仍只有一个部件，内容取排序后第一个**

包里仍是一份 `slideMaster1.xml` 与一份 `slideLayout1.xml`，内容从 `masters`/`layouts` 里排序后第一个填。理由是与同文件里既有的 `effectiveTheme` 同一条规则（也只写一个 `theme1.xml`），这一刀不改包结构。**多母版文档因此仍会塌成一个** —— 这是既有行为，本刀不使其更坏，但要在记录里点名为下一刀。

**决策 3：母版/版式的图片背景本刀不做**

图片背景要在母版/版式**自己的关系文件**里加媒体关系，那是另一套物化路径。纯色、渐变与 `bgRef` 三种照写；模型里只有图片背景时写不出（今天也写不出），记为已知限制。编辑器目前也没有改母版背景的命令，图片母版背景只能来自导入。

**决策 4：`p:txStyles` 复用文本序列化器，只加一个层级壳**

`serializeMarks` 与 `serializeParagraphProperties` 加一个标签名参数，`a:defRPr` 与 `a:lvl{N}pPr` 因此和 `a:rPr`/`a:pPr` 共用同一份属性逻辑 —— 否则同一个 `sz`/`algn` 会在两处各写一遍、迟早写歪。`a:defRPr` 排在 `a:pPr` 的子元素序列**末尾**（`CT_TextParagraphProperties` 的 sequence 是 lnSpc → spcBef → spcAft → bu* → tabLst → defRPr）。

**决策 5：占位符 `defaults` 本刀不做**

`ElementDefaults` 要写成母版/版式里带 `p:ph` 的 `p:sp`，还要和幻灯片元素的 `p:ph type/idx` 对齐 —— 独立一刀。本刀之后 `defaults` 仍是往返丢失项，但**它丢失的后果比颜色映射轻**：导出的元素自己带显式 bounds 与文本属性，只有「没自己声明的那些 run 属性」会退回默认。

## 4. 契约（增量）

`@ppt4ai/pptx-export`：

- `serializeMasterXml(master?, colorMap)`：写 `p:bg`、`p:clrMap`（完整 12 槽）、`p:txStyles`
- `serializeLayoutXml(layout?, colorMapOverride?)`：写 `p:bg`、`p:clrMapOvr`
- `serializeSlideXml(..., colorMapOverride?)`：写 `p:clrMapOvr`
- `text-xml.ts`：`serializeMarks`/`serializeParagraphProperties` 接受标签名；新增 `serializeLevelDefaultsXml`

模型、导入、渲染不动。

## 5. 测试策略

- **母版**：`p:clrMap` 的 12 个属性来自模型合并结果；`p:bg` 写纯色；`p:txStyles` 的三个样式各写出 `a:lvl{N}pPr` 与 `a:defRPr`（层级升序）
- **版式**：`p:clrMapOvr/a:overrideClrMapping` 合并了母版映射；无覆盖时写 `a:masterClrMapping`
- **幻灯片**：同上，且 `p:clrMapOvr` 在 `p:cSld` 之后（`CT_Slide` 的 sequence）
- **往返**：母版颜色映射、两级覆盖、母版背景、版式背景、`textStyles` 全部回来；显式断言决策 1 的「2 槽变 12 槽」
- **回归**：现有 1699 项，其中 `standalone.test.ts` 断言过空骨架的用例需要跟着改

## 6. 已知限制

- 多母版/多版式仍塌成一个（决策 2）—— 下一刀
- 母版/版式的图片背景仍写不出（决策 3）
- 占位符 `defaults` 仍不往返（决策 5）
- `p:hf`、`p:transition`、`p:timing`、母版的 `p:sldLayoutIdLst` 多条目仍不建模
- 仍无阅读器实测

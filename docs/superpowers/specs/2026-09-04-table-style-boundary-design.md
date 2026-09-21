# 表格样式跨文件边界设计

> 状态：已实现（2026-09-04，`32cb705`）
> 日期：2026-09-04

## 1. 目标

让**表格样式**（`ppt/tableStyles.xml`）真正跨过文件边界。今天三处都断着，而且是三个独立的断点：真实文件里的样式边框读不进来、粗体斜体读不进来、`document.tableStyles` 一个字都写不出去。分组独立导出那一刀补完了「五种 kind 都能导出」，这一刀补的是**表格样式这条引用链**。

## 2. 探针结果（实测，`table-style-probe.test.ts`，已删除）

**探针一 —— `a:tcTxStyle` 的 `b`/`i`**：

```
b="on" i="off"（ECMA 的 ST_OnOffStyleType）-> {"color":{"type":"srgb","v":"FFFFFF"}}   // 粗体斜体全丢
b="1"  i="0"  （schema 不允许的写法）      -> {"bold":true,"italic":false,"color":…}  // 反而读得进
```

`parseStyleText`（`importer.ts:530`）只认 `'1'`/`'0'`。而 ECMA-376 里 `CT_TableStyleTextStyle` 的 `b`/`i` 是 **`ST_OnOffStyleType`，取值 `on`/`off`/`def`** —— 与 `a:rPr/@b` 那种 `ST_OnOff`（`0`/`1`/`true`/`false`）不是同一个类型。**结论是导入器只接受 schema 不允许的写法、并拒绝唯一合法的写法**（这是 schema 事实，不是对某个阅读器行为的断言）。

**探针二 —— `a:tcStyle/a:tcBdr` 的子元素名**（同一段样式换三种边框写法）：

```
<a:tcBdr><a:lnL w="12700"><a:solidFill/></a:lnL></a:tcBdr>            -> {"left":{…}}  // 读得进
<a:tcBdr><a:lnL><a:ln w="12700"><a:solidFill/></a:ln></a:lnL></a:tcBdr> -> null
<a:tcBdr><a:left><a:ln w="12700"><a:solidFill/></a:ln></a:left></a:tcBdr> -> null       // ECMA 的写法
```

`parseStyleBorders`（`importer.ts:542`）找的是 `lnL`/`lnR`/`lnT`/`lnB` 并直接在该节点上读 `w` 与 `a:solidFill` —— 那是 **`a:tcPr`（单元格自己的属性）的词汇**。表格样式里 `CT_TableCellBorderStyle` 的子元素是 `a:left`/`a:right`/`a:top`/`a:bottom`（还有 `insideH`/`insideV`/`tl2br`/`tr2bl`），每个都是 `CT_ThemeableLineStyle`，**里面再包一层 `a:ln`**。两处名字与嵌套都不同，而这个函数被当成通用的用在了样式侧，于是**样式边框从没读进来过**。现有测试没抓到，因为 `importer.test.ts:568` 的 fixture 本身就是按错的形状写的。

**探针三 —— 独立导出**（把带样式的表格导一遍再导回来）：

```
hasTableStylesPart:      false
tblPr:                   <a:tblPr tableStyleId="style-1" firstRow="1" bandRow="1"></a:tblPr>
relsMentionsTableStyles: false
reimportedStyles:        null                                  // 整个 tableStyles 面丢光
reimportedReference:     {"styleId":"style-1","firstRow":true,"bandRow":true}  // 引用本身没丢
```

引用写出去了、被引用的部件没写。表格的九个区域样式（填充、边框、文字色/粗斜）在独立导出里**全部丢失**。

## 3. 关键决策

**决策 1：导入端按 ECMA 形状读，旧形状留作兼容**

`a:tcBdr` 下先找 `a:left`/`a:right`/`a:top`/`a:bottom` 并解开里面的 `a:ln`；找不到再退回旧的扁平 `lnL`/`lnR`/`lnT`/`lnB`。留兼容不是为了迁就测试 fixture，而是与这段代码既有的宽容度一致 —— 它本来就接受 `a:wholeTbl/a:solidFill` 这种同样不合 schema 的直接填充（`directFill ?? nestedFill`）。宽容读**取值仍然严格**：`w` 不是正整数就整条边框丢弃，这条不动。

**决策 2：`b`/`i` 接受 `on`/`off`/`def`，`def` 视为「未声明」**

`def` 的语义是「跟随继承」，因此映射成字段缺席，而不是 `false`。原有的 `1`/`0` 继续接受（同决策 1 的理由）。导出写 `on`/`off`。

**决策 3：`document.tableStyles` 非空时才写 `ppt/tableStyles.xml`**

空表不写部件：写一个空的 `a:tblStyleLst` 只增加一个没有信息的部件，而且 `def` 无处可指。同时补上 content-type override 与 `presentation.xml.rels` 里的 `tableStyles` 关系（关系放在幻灯片之后取 `rId${3+slideCount}`，幻灯片的 `r:id` 因此不动）。

**决策 4：`a:tblStyleLst/@def` 取排序后的第一个样式 id**

`def` 在 schema 里是必需属性，而模型不存源文件的 `def`（`parseTableStyles` 从来不读它）。取「排序后第一个」是确定性的最小选择，也不发明新值。`def` 的语义是「新插入表格用哪个样式」，与已有表格的呈现无关。

**决策 5：不动 `tableStyleId` —— 本地没有该样式**不等于**悬空引用**

Office 的内置表格样式（Medium Style 2 Accent 1 之类）以 GUID 引用、**不随包分发**，阅读器从自己的库里解析。所以「引用了本包没有的样式」是完全正常的文件，删掉引用会把真实样式弄丢。这条与 `fmtScheme` 那次「写空列表导致 `lnRef` 悬空」不同：那边的引用只能由包内解析，这边不是。

## 4. 契约（增量）

`@ppt4ai/pptx-import`：`parseStyleBorders` 读 ECMA 形状（保留旧形状回退）；`parseStyleText` 接受 `on`/`off`/`def`。

`@ppt4ai/pptx-export`：新增 `serializeTableStylesXml(styles)` 写 `a:tblStyleLst`（九个区域，`a:tcTxStyle` + `a:tcStyle/a:tcBdr` + `a:tcStyle/a:fill`）；`ppt/tableStyles.xml` 进包、进 content types、进 presentation 关系。

模型、渲染、编辑器不动：`TableStyle` 与 `resolveTableCellStyle` 早已完整，缺的只是两端的 I/O。

## 5. 测试策略

- **导入**：ECMA 形状的四条边框各自进模型；`a:ln` 里的 `w`/`prstDash` 生效；旧扁平形状仍能读（回退）；`b="on"`/`i="off"` 进模型，`def` 不进，非法值仍丢弃
- **导出**：九个区域各自写出；`a:tcTxStyle` 写 `on`/`off`；边框写 `a:left/a:ln`；填充写 `a:tcStyle/a:fill`；空 `tableStyles` 不写部件；content type 与关系都在
- **往返**：带九个区域的样式过 `createPptx` → `importPptx` 原样回来（这是这一刀真正的验收条件：三个断点任何一个还断着，它就过不了）
- **回归**：现有 1687 项，其中 `importer.test.ts` 的表格样式 fixture 需要补 ECMA 形状的用例（旧用例保留，因为决策 1 保留了回退）

## 6. 已知限制

- `insideH`/`insideV`/`tl2br`/`tr2bl` 四个区域内边框仍不建模（`TableCellBorders` 只有四边）。真实 Office 样式常用 `insideH`/`insideV` 画内部网格线，因此这部分样式读进来仍是空的 —— 要做需要 `resolveTableCellStyle` 按「是否处于表格边缘」把内外边框分派到每个单元格的四边，是独立一刀
- **内置样式仍解析不了**（决策 5）：引用 Office 库里的 GUID 时，画布上是无样式表格。要做需要把 Office 的内置样式表搬进仓库，那等于发明大量数值
- `a:tblStyle/@styleName`、`a:cell3D`、`a:fillRef`/`a:lnRef`（样式里的主题引用）仍不建模
- `a:tblStyleLst/@def` 不往返（决策 4）
- 仍无阅读器实测

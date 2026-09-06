# 主题的颜色节点改成打补丁

> 状态：设计中
> 日期：2026-09-06

## 1. 目标

`rewriteThemeXml` 改一个色位时整块替换那个颜色元素，并且用一份私有的颜色镜像去判断「变了没有」。这一刀让它只改该改的那一格，并把镜像接到 `color-source.ts`——这是本条线索里最后一份私有颜色读取器。

## 2. 探针结果（实测 2026-09-06）

探针已删除。一个 `a:clrScheme` 里的 `a:accent1`，模型给出新颜色：

| 源包写 | 模型带 | 现在导出 | 后果 |
|---|---|---|---|
| `<a:hslClr hue="0" sat="0" lum="0"/>` | `srgb FF0000` | `<a:hslClr …/><a:srgbClr val="FF0000"/>` | **一个色位里两个颜色子元素——非法 XML** |
| `<a:srgbClr val="zz"/>` | `srgb FF0000` | **抛 `PPTX export theme source malformed`** | 整个导出失败 |
| `<a:sysClr val="window" lastClr="FFFFFF"/>` | `system 112233` | `<a:sysClr val="windowText" lastClr="112233"/>` | **系统色名被改写** |
| `<a:srgbClr val="336699" data-keep="yes"><a:lumMod val="80000" data-t="keep"/></a:srgbClr>` | 改了颜色与 `lumMod` | `<a:srgbClr val="FF0000"><a:lumMod val="60000"/></a:srgbClr>` | 两处未建模属性都没了 |
| `<a:scrgbClr r="20000" g="30000" b="40000" data-keep="yes"/>` | 改了一个通道 | 属性没了 | 同上 |

第一行与上一刀同一类损坏：**输出的 XML 打不开**。`EG_ColorChoice` 是 choice，一个色位只能有一个颜色元素；私有镜像的名字集合里没有 `a:hslClr`，于是「找不到旧颜色」→ 走插入分支 → 新颜色被追加在旧的后面。重置到默认色（`accent1: null`）也走同一条路，而重置是真实的 UI 动作。

第二行是**一个坏颜色让整份文件导不出去**，与上一刀在占位符那侧删掉的 `placeholder fill malformed` 是同一种守门方式。

第三行的触发面要说准：`a:sysClr/@val` 只有在**模型仍然说 `system`、而它的值或 transform 变了**时才被改写（`serializeColorXml` 把 `val` 硬编码成 `windowText`）。从 UI 挑一个新颜色会把类型变成 `srgb`，那属于换种类、整块替换，`val` 本来就留不住。但程序驱动模型正是这个项目的用途，所以这条不是纸面问题——`window` 与 `windowText` 在系统层是黑白相反的两个颜色。

## 3. 一个根因

`theme-writeback.ts` 自带 `parseColor` + `sourceColor` + `colorsEqual` 三件，与 `color-source.ts` 的 `sourceColor`/`fill-patch.ts` 的 `colorsEqual` 逐行近似。**上一刀刚因为同样的私有副本修过两个 bug**（七词白名单让合法文档导不出、只认双引号让输出多一个属性），这是同一份清单上的最后一项。私有镜像与共享镜像的差别正好落在 `a:hslClr` 上：共享的那份把它算进「颜色元素」（因为要替换它），私有的那份不算，于是插了第二个颜色。

## 4. 关键决策

**决策 1：三层判据，与填充那套同构**

- 颜色**种类**变了（`a:srgbClr` → `a:schemeClr`，或源里那个颜色读不出来）→ 整块替换那个元素，choice 之间没有对应关系。
- 种类相同、只有**值**变了 → 只改值属性（`val`；`sysClr` 改 `lastClr`；`scrgbClr` 改 `r`/`g`/`b`），子元素一个字节都不动。
- 种类相同、**transform 列表**变了 → 改值属性，并把子元素整段换成模型的 transform 列表。

第三条为什么不逐个 transform 打补丁：镜像会跳过 `val` 非法的 token 子元素，所以「第 i 个子元素对应第 i 个 transform」不成立；而按类型名配对在同类型出现两次时（`EG_ColorTransform` 是无上限的 choice，合法）会错。整段替换只在 transform 真的变了时发生，代价是那时丢掉 transform 子元素上未建模的属性——**明写进已知限制**。

**决策 2：值属性走上一刀那份共享补丁器**

`xml-range.ts:attributeReplacements` 保留源的引号、值相同就不写。因此 `<a:srgbClr val='336699'/>` 改颜色后仍是单引号，`a:sysClr/@val` 因为「值相同」自然不被碰。`sysClr` 缺 `val` 时按 `windowText` 补一个（这是序列化器原本的行为，源里少了必需属性时不因为改颜色而继续少）。

**决策 3：删掉私有镜像，`color-source.ts` 增加 `sourceColorNode`**

主题需要那个**节点**才能打补丁，而 `sourceColor` 只返回 `Color`。因此 `color-source.ts` 增加 `sourceColorNode(element)`（返回 `{ node, color }`），`sourceColor` 改成它的一层包装——一份实现，两个出口。主题的 `parseColor`/`sourceColor`/`colorsEqual`/`colorNodeNames`/`parsePercentage`/`parseHexColor` 全删。

**决策 4：`colorChoiceNames` 与 `colorsEqual` 挪到 `color-source.ts`**

它们现在在 `fill-patch.ts`，而 `fill-patch.ts` → `standalone-xml.ts` → `master-layout-writeback.ts` 已经是一个环（早于本条线索存在）。主题写回只需要「镜像 + 比较」，不该为此挂上填充与序列化器那一串。`color-source.ts` 是叶子（只 import 模型与 `XmlElement` 类型），且这两样本就是镜像契约的一部分：一个是「颜色元素叫什么名字」，一个是「源与模型是否说了同一件事」。`fill-patch.ts` 与 `writeback.ts` 改从 `color-source.ts` 取。

**决策 5：源里读不出的颜色不再抛错**

与上一刀在占位符那侧同一个判断：读不出来意味着「每一格都算变了」，于是那个元素被替换成模型的颜色——把坏值修好，而不是让整份文件导不出去。`malformedTheme` 只留给「`a:clrScheme` 找不到」「XML 扫不动」这两种真的没法继续的情况。

## 5. 契约（增量）

- `color-source.ts` 新增 `sourceColorNode(element)` 与 `colorChoiceNames`、`colorsEqual`（后两者从 `fill-patch.ts` 迁入，不是新写）。
- `theme-writeback.ts`：改一个色位只改值属性；transform 变了才换子元素；种类变了才换元素。
- 错误面变化：`theme source malformed` 不再因为「某个颜色节点读不出」产生。
- 对外行为：`a:hslClr` 色位不再产出两个颜色子元素；`a:sysClr/@val` 不再被改写成 `windowText`；颜色元素上未建模的属性在改颜色时保留。

## 6. 验证

`packages/pptx-export/src/theme-color-patch.test.ts`：

- 改颜色 → 只有 `val` 变，`data-keep` 与两个 transform 子元素（含子元素上的 `data-t`）逐字保留
- 源用单引号写 `val` → 改颜色后仍是单引号，且只有一个 `val`
- `a:sysClr` 改 `lastClr` → `val="window"` 逐字保留
- `a:sysClr` 缺 `val` → 补 `windowText`
- `a:scrgbClr` 改一个通道 → 另两个与 `data-keep` 不动
- transform 列表变了 → 子元素整段换掉，颜色元素自己的属性仍在
- transform 列表清空 → 子元素没了，元素变成自闭合形式之外的空壳（`<a:srgbClr val="…"></a:srgbClr>`）也接受，只断言没有 transform
- 种类变了（srgb → scheme）→ 元素整块换掉，且色位的 `data-slot` 与兄弟 `a:extLst` 仍在
- 色位里是 `a:hslClr` → 元素被换掉，**色位里只有一个颜色子元素**
- 源里 `val="zz"` → 不抛，元素被换成模型的颜色
- 自闭合的空色位 `<a:accent1/>` → 展开并写入颜色（既有行为不回退）
- 未编辑 → 逐字节等于源（源里用单引号与倒序属性写，确保这条有区分力）

`theme-writeback.test.ts` 三条既有预期按新行为更新：`patches a changed color…`（`customTransform` 现在只在 transform 列表变了时才没）、`resets null colors…`、以及 `a:accent2` 那条插入路径。

区分力：把「种类相同就打补丁」退回整块替换 → 几条标红；把节点查找退回不含 `hslClr` 的名字集合 → `a:hslClr` 那条标红。

## 7. 已知限制

- **transform 子元素上未建模的属性只在 transform 列表不变时保留**（决策 1 第三条）。逐个打补丁需要镜像交出「它保留了哪些节点」，那是更大的一刀。
- **无源导出仍写 `val="windowText"`**：`serializeColorXml` 不知道系统色名，因为模型不建模它。要真正修得给 `Color` 加一个字段，是导入、模型、导出三处的另一刀。
- **`master-layout-writeback.ts` 仍有第二份属性补丁实现**（上一刀的决策 5）。
- **`fmtScheme` 里的颜色写回仍不存在**：`rewriteThemeXml` 从不访问它，所以那里的颜色既不会被改也不会被写坏（`theme-writeback.test.ts` 已有两条钉着）。

## 8. 实现记录

待填。

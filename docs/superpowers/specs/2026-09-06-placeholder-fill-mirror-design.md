# 占位符的填充改走幻灯片那一套镜像与补丁

> 状态：设计中
> 日期：2026-09-06

## 1. 目标

`master-layout-writeback.ts` 对占位符的填充与描边自带三样私货：一份只认 `a:solidFill` 颜色的源侧镜像、一份七个词的颜色 transform 白名单、一条整块重写填充节点的写法。三样在幻灯片写回里都已有共享版本，三样都已漂移。这一刀把占位符接到共享版本上。

## 2. 探针结果（实测 2026-09-06）

探针已删除。`rewriteMasterXml` 拿一个占位符的 `p:spPr` 与对应的 `ElementDefaults`：

| 源包写 | 模型带 | 现在导出 | 损失 |
|---|---|---|---|
| `a:gradFill`（两停靠点 + `a:lin` + `@flip` + `@rotWithShape` + `a:tileRect`） | 同一个渐变 | `<d:solidFill><d:srgbClr val="112233"/></d:solidFill>` | **整个渐变被压成第一个停靠点的纯色** |
| `a:pattFill prst="dashDnDiag"`（前景/背景 + `a:extLst`） | 同一个图案 | `<d:solidFill><d:srgbClr val="112233"/></d:solidFill>` | **整个图案被压成前景纯色** |
| `a:ln` 里的 `a:gradFill` | 同一个渐变 | `a:ln` 里变成 `a:solidFill` | **描边渐变被压成纯色** |
| `a:solidFill data-fill="keep"`（颜色带 `a:comp`，兄弟 `a:extLst`） | 改了颜色 | `<d:solidFill><d:srgbClr val="FF0000"/></d:solidFill>` | 属性、`a:extLst`、`a:comp` 全没 |
| `a:ln` 里 `a:solidFill data-stroke="keep"` | 改了描边色 | 属性没了（`@w`、`a:prstDash` 在节点外，活着） | 同上 |
| 颜色带 `a:satMod val="160000"` | 导入端原样保留了它 | **抛 `PPTX export master unsupported color fill`** | 整个导出失败 |
| 颜色带无 `val` 的 `a:comp` | 导入端原样保留了它 | **抛同一个错** | 整个导出失败 |

前三行是**模型如实带着的内容被丢掉**，不是「未建模的部分」被丢掉——比前两刀严重一级。后两行是**合法文档导不出去**：`validateDocument` 判它合法（transform 类型只要过 `isOoxmlToken`、值只要过 `colorTransformValueIsValid` 就行），而这个模块的私有校验既有七词白名单又把值卡在 0..100000。

`colorTransformValueIsValid` 的注释写着「`*Mod` 家族不能卡 100000 —— 卡它是 `satMod` 当年消失的第二个原因」。**这个私有副本把当年修掉的两个错各犯了一遍。**

## 3. 一个根因

`color-source.ts` 的 `sourceFill` 头上就写着这条教训：

> Without this a `gradFill` source compared as "no fill", so the moment the importer started reading gradients every edited deck had them overwritten with a flat first stop.

幻灯片那一侧照这句话修好了，master/layout 这一侧从没修——**同一处伤只包了一半**。占位符的 `defaults.fill` 走的是导入端 `parseShapeFill` → `parseDirectFill`，与元素完全同一个解析器，所以渐变、图案本来就在模型里；只有写回这一端读不出来，于是每次导出都判「变了」，再按它唯一会写的形状写成纯色。

`rewriteMasterXml` 在 `writeback.ts:1722` 是**无条件**调用的，所以这不是「编辑了占位符才发生」，而是任何一次经过写回的导出都发生。

## 4. 关键决策

**决策 1：比较用 `sourceFill`，删掉私有颜色镜像**

`sourceFill` 是被 `writeback-mirror-agreement.test.ts` 钉在 `parseDirectFill` 上的那一份，能读实心、线性渐变、图案。占位符用它之后，未编辑的渐变与图案比较相等，一个字节都不写。

**决策 2：同种打补丁，换种整块替换**

与幻灯片同一个 `sameKindFillPatches`：改停靠点只换 `a:gsLst`，改图案前景只换 `a:fgClr`，改实心颜色只换颜色子元素；`EG_FillProperties` 是 choice，换种类没有对应关系可留，仍整块替换。

**决策 3：补丁器提到共享模块，因为依赖方向不能反**

`writeback.ts` 已经 import `master-layout-writeback.ts`，所以共享代码不能留在 `writeback.ts` 里。新建叶子模块 `fill-patch.ts`，把 `sameKindFillPatches`、`childReplacement`、`fillsEqual` 一族、`fillKind`、`modelFillNodeName`、`namespacePrefix`、前缀重写与 `colorChoiceNames` 搬过去，两个写回都 import 它。**是搬不是抄**——上一刀（`cdd2316`）已经证明抄一份的下场就是本刀在修的这个。

`lineAttributeReplacements` 一起搬，并改名 `attributeReplacements`：它对任何元素都成立，`line` 是历史残留，上一份设计文档已经记过这句。`writeback.ts:326` 那个从未被使用的 `colorTransformTypes` 顺手删掉——留着会让人以为幻灯片那侧也在做白名单校验。

**决策 4：颜色的 transform 规则改用模型自己的谓词**

私有白名单换成 `isOoxmlToken` + `colorTransformValueIsValid`，并接受无 `val` 的开关形（`a:comp`/`a:inv`/`a:gray`），与导入端 `parseColorTransforms` 及 `validateDocument` 逐条一致。`theme-writeback.ts` 有同一份白名单、同一个崩法，**它的读与校验两侧一起改**（只改一侧会让未编辑的主题色被判成变了）。

**决策 5：镜像补上径向 `a:path` 形态**

`sourceFill` 只在有 `a:lin` 时才认渐变，而导入端 `parseGradientNode` 读 `a:lin` 与 `a:path` 两种。所以今天每一次导出都会重写径向渐变的填充节点（幻灯片也一样）。不补这个缺口，「未编辑不重写」这条对径向就不成立，本刀的测试只能把这个损失写进预期——**前三刀反复撞见的就是这种测试**，不再写一条。

**决策 6：模型侧校验保留，但覆盖整个填充**

`exportPptx` 这条路上没有 `validateDocument`（它只在 `standalone.ts` 的无源路径上），所以这个模块的校验是唯一的守门人，不能删。它从只查 `fill.color` 扩到渐变每个停靠点与图案两色，并顺带把颜色规范化（十六进制统一大写）后再比较，否则大小写不同会被判成「变了」。

**决策 7：源包里读不出的颜色不再报错，也不再连节点一起换掉**

原来 `a:solidFill` 里有个认得名字但读不出的颜色节点会抛 `placeholder fill malformed`。保留它就得保留一份私有的颜色名字集合——正是本刀要删的私货。删掉之后这种源被当成「每一格都变了」：颜色子元素被换掉（`a:hslClr` 也算，否则会在一个 `a:solidFill` 里留下两个颜色，违反 choice），节点自己与其余子元素原样留下。今天 `a:hslClr` 走的已经是不抛这条路（探针确认），所以是把两种读不出的颜色统一。

**决策 8：「同种」的判据是节点名，不是镜像读出了东西**

共享的 `sameKindFillPatches` 现在接受 `existing?: Fill`：读不出来只意味着每一格都算变了，不意味着节点必须整块换掉。因此判据从「镜像读出了同种填充」收敛成「节点名就是模型这种填充要写的那个名字」。**幻灯片那一侧一并受益**：一个只有一个停靠点的 `a:gradFill`（镜像按导入端规则读成纯色）在模型给出两个停靠点时，此前整块换掉，现在只换 `a:gsLst` 与轴。

## 5. 契约（增量）

- 新模块 `fill-patch.ts`（包内私有，不进 `index.ts`）：`fillNodeReplacements`、`sameKindFillPatches`、`childReplacement`、`attributeReplacements`、`fillsEqual`/`colorsEqual`/`gradientsEqual`/`patternsEqual`、`fillKind`、`modelFillNodeName`、`namespacePrefix`、`reprefixed`、`serializeFillPrefixed`、`fillNodeNames`、`colorChoiceNames`。
- `color-source.ts`：`sourceFill` 认径向 `a:path`（`path` 与 `fillToRect` 两项，按 `parseGradientNode` 的取值规则）。
- `@ppt4ai/pptx-export` 对外行为：`rewriteMasterXml`/`rewriteLayoutXml`/`rewritePlaceholderPartXml` 不再把占位符的渐变与图案写成纯色，不再因为一个 `satMod` 抛错，改填充只动该动的那一格。`rewriteThemeXml` 不再因为 `satMod` 或 `a:comp` 抛错，且带这类 transform 的未编辑色位不再被重写。
- 错误面变化：`placeholder fill malformed` / `placeholder stroke malformed` 两条不再产生（决策 7）；模型侧新增四类稳定错误（非 token 的 transform、坏的停靠点颜色/位置、坏的 `path` 词、越界内缩），都沿用既有的 `unsupported color ${field}` 措辞。

## 6. 验证

`packages/pptx-export/src/placeholder-fill-patch.test.ts`（16 条）。**每个源侧样例都有一处「序列化器不会那样写」的拼法**——`a:lin` 属性倒序、`a:fillToRect` 的两个内缩倒序、颜色用单引号——否则「未编辑就逐字节相同」什么也证明不了：比较坏掉时补丁器会把同值的那一格按规范拼法重写一遍，字节仍可能相同。有了这些拼法，字节相同才等于「一个字都没写」。

- 未编辑的渐变 / 径向渐变 / 图案 / 渐变描边 → 逐字节等于源
- 改渐变停靠点 → 只换 `a:gsLst`，`flip`/`rotWithShape`/`a:lin`（倒序拼法）/`a:tileRect` 逐字保留
- 改图案前景色 → 只换 `a:fgClr`，`@prst`、背景色（单引号拼法）、`a:extLst` 不动
- 改实心颜色 → 只换颜色子元素，`data-fill` 与 `a:extLst` 保留
- 改描边色 → `a:ln` 里只换颜色子元素，`@w`/`a:prstDash`/`data-stroke` 保留
- 实心 → 渐变（换种类）→ 整块替换，且 `data-fill` 确实丢掉（既有代价，明写在断言里）
- 颜色带 `satMod val="160000"` 与无 `val` 的 `a:comp` → 不抛，逐字往返
- `a:hslClr` → 颜色被换掉、只剩一个颜色子元素，而节点的 `data-fill` 仍在
- 空的自闭合 `a:solidFill` → 展开并写入颜色
- 非 OOXML token 的 transform、非十六进制的停靠点颜色、`path="ellipse"`、内缩 200000 → 四条稳定错误
- 只有 `rotation` 的占位符、以及 `a:blipFill` 占位符 → 逐字节等于源

`writeback-mirror-agreement.test.ts`：径向渐变一条「两边读法一致」。

`gradient-writeback.test.ts`：未编辑的径向渐变元素在文本编辑后逐字保留，改 `a:fillToRect` 只换 `a:path`（决策 5 在幻灯片侧的对应断言）。

`master-layout-writeback.test.ts` 既有一条 `patches placeholder geometry, rotation, fill, stroke, preset, and text` 的预期里写着 `data-fill="keep"` 被丢掉——**这条测试名字里的 `patches` 自己就说了要打补丁**，预期改成属性保留。`writeback.test.ts` 的 `writes imported master, layout, and slide defaults and color maps` 同样一条，同样改法。`theme-writeback.test.ts` 的 `returns the exact source when defined colors are unchanged` 的模型补上源里那三个 transform（含 `satMod` 与无 `val` 的那个），它此前是照旧的窄读法手写的。

区分力（三次实测）：把镜像退回只读 `solidFill` 颜色 → 6 条标红；把「同种打补丁」退回整块替换 → 9 条标红（含 `fill-node-patch.test.ts` 的 5 条）；把 transform 规则退回七词白名单 → 1 条标红。

## 7. 已知限制

- **主题的颜色节点仍整块替换**：`rewriteThemeXml` 换一个色位时替换整个 `a:srgbClr`，它未建模的 transform 子元素（`a:customTransform`，真实文件里是 `a:comp`/`a:gray` 这类）会丢。`theme-writeback.test.ts` 现有预期正把这个损失固定着。本刀只修它的 transform 规则，颜色节点打补丁是下一刀。
- **主题写回仍自带一份颜色镜像**：与 `color-source.ts` 的 `sourceColor` 逐行近似但返回节点，下一刀一起收。
- **占位符的图片填充根本不建模**：`ElementDefaults` 没有 `pictureFill` 字段（它挂在 `ShapeElement`/`TextElement`/`TableCell`/`SlideBackground` 上，不在 `Fill` 里），导入端 `parseDirectFill` 也不读 `a:blipFill`。所以带 `a:blipFill` 的占位符 `defaults.fill` 为空、写回直接早退、源节点原样留下——今天是对的，但它的图片填充也无法编辑。
- **换填充种类仍丢未建模内容**：与上一刀同一个理由，choice 之间没有对应关系。

## 8. 实现记录（2026-09-06）

四个提交：设计 `1a99d9b`、共享模块 `9236987`、径向镜像 `b97a744`、占位符填充 `73b4e88`。

**与设计的偏差三处，都是实现过程中发现的**：

**决策 8 是写的时候才冒出来的**（已补进第 4 节）。原打算照抄幻灯片侧的判据「镜像读出了同种填充」，写 `a:hslClr` 那条测试时才看清：读不出来会让它走整块替换，于是 `data-fill` 照样丢。改成按节点名判断之后，`sameKindFillPatches` 的 `existing` 变成可选，三处「打补丁还是整块换」的判断收成一个 `fillNodeReplacements`，**幻灯片那侧也跟着变好**（单停靠点的 `a:gradFill` 此前整块换）。

**校验面比设计写的更宽一格**：设计只说「扩到渐变每个停靠点与图案两色」，实现时补上了渐变自己的 `angle`/`scaled`/`path`/`fillToRect`——它们同样进属性，不查就会写出没有阅读器接受的 XML。规则照 `validateGradient` 抄。

**第 7 节那条「图片填充」的限制原本写错了**：`Fill` 上没有 `pictureFill` 字段（它挂在 `ShapeElement`/`TextElement`/`TableCell`/`SlideBackground` 上），所以不存在「被当成实心写出」这回事。已改成真实情况：占位符的图片填充完全不建模，因此源节点原样留下。

**最该记住的一条：第一版的「未编辑就逐字节相同」测试毫无区分力。** 把镜像退回只读 `solidFill` 颜色之后，16 条**全绿**。原因是补丁器只会替换 `a:gsLst` 与轴，而样例里模型序列化出来的字节与源逐字相同——「什么都没写」与「把同样的东西又写了一遍」看起来一样。把每个样例改成有一处序列化器不会用的拼法（`a:lin` 属性倒序、内缩倒序、单引号）之后，同一个破坏让 6 条标红。**字节相同只有在源的拼法是序列化器不会产生的时候，才等于「没有写」。**

三次破坏性验证：镜像退回颜色-only → 6 条红；同种补丁退回整块替换 → 9 条红；transform 规则退回七词白名单 → 1 条红。

门禁：2075 项测试、全量 typecheck、全量 build、包边界检查、7 个 e2e 全绿。

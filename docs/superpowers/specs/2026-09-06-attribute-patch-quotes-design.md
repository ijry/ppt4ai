# 改一个属性时不再制造重复属性

> 状态：设计中
> 日期：2026-09-06

## 1. 目标

源包用单引号写属性时，写回改动那个属性会**插入第二个同名属性**，而不是替换原来的。这一刀把「改一个属性」收成一份实现，并让它认两种引号。

## 2. 探针结果（实测 2026-09-06）

探针已删除。源包写 `<a:ln w='12700' cap='rnd'>`，模型把线宽改成 25400、端点改成 `flat`，导出得到：

```xml
<a:ln cap="flat" w="25400" w='12700' cap='rnd'>
```

`<a:pattFill prst='dashDnDiag'>` 改预设同样得到 `prst="ltUpDiag" prst='dashDnDiag'`。

**重复属性在 XML 里不是「不规范」，是致命的良构错误**（`WFC: Unique Att Spec`），严格解析器直接拒绝这个部件——文件打不开。而宽松解析器取最后一个，**也就是旧值**：把这份输出喂回 `importPptx`，读回来的是 `strokeWidth: 12700`、`strokeCap: 'rnd'`，两处编辑静默消失。

受影响的编辑：`a:ln` 的 `w`/`cap`/`cmpd`/`algn`、`a:outerShdw` 的 `blurRad`/`dist`/`dir`、`a:pattFill` 的 `prst`。触发条件只有一个——源包那个属性用单引号写。单引号在 XML 里完全合法。

## 3. 一个根因：四份副本

「替换开标签里一个属性的值」在这个包里有四份实现：

| 实现 | 引号 | 判断 |
|---|---|---|
| `xml-range` 将要接管的 `fill-patch.ts:attributeReplacements` | 只认双引号 | **坏** |
| `writeback.ts:lineWidthReplacements`（内联的同一段） | 只认双引号 | **坏** |
| `theme-writeback.ts:attributeReplacement` | 两种都认 | 对 |
| `master-layout-writeback.ts:updateOpeningAttribute` | 两种都认 | 对 |

**这个仓库早就学过这一课**：`master-layout-writeback.test.ts` 有一条测试叫 `preserves single-quoted mapping attributes when changing a value`。两份对的实现各自记着它，两份坏的没有——这正是上一刀反复在修的那件事，只不过这次副本之间的差别不是「读得少」而是「写坏了」。

坏的那两份还共享一个更深的毛病：**匹配失败时它们回退到「插入」**。regex 不匹配被当成「这个属性不存在」，而属性明明在那里，只是引号不一样。所以一处拼法差异变成了一处结构损坏。

## 4. 关键决策

**决策 1：共享实现放 `xml-range.ts`**

它是 `Replacement`、`tagEnd`、`replaceRanges` 的家，也是唯一一个「按字节范围改 XML」的模块。`fill-patch.ts` 不合适——它是填充的事，属性补丁对任何元素都成立（这句上一刀已经在它的注释里写过一次）。为了转义值，`xml-range.ts` 会 import `text-xml.ts` 的 `escapeXml`；两个模块此前都是叶子，`text-xml.ts` 不 import `xml-range.ts`，因此不成环。

**决策 2：保留源自己的引号字符**

替换的是引号之间的内容，引号本身不动。这样一次编辑不会顺带把 `cap='rnd'` 改成 `cap="rnd"`，无谓 churn 少一处，也让「未编辑的部分逐字不变」这条更硬。

**决策 3：值要转义**

主题的 `typeface` 是用户输入，`theme-writeback.test.ts` 已有一条断言 `typeface="Georgia &amp; &quot;Co&quot;"`。共享实现用 `escapeXml`，两种引号都转义，因此保留源引号不影响正确性。

**决策 4：数值属性的比较留在调用点**

`lineWidthReplacements` 现在按数字比（`w="12700"` 与 `12700` 相等）。共享实现按字符串比，所以 `w=" 12700 "` 这种拼法会被判成变了。把数值比较留在调用点，不把这条宽容度丢掉。

**决策 5：`master-layout-writeback.ts` 的那一份不动**

它形状不同——吃开标签的原始字符串、返回新字符串（`boundsReplacements` 靠这个在一个范围里连改两个属性），并且带 `kind`/`id` 的稳定错误。它本来就是对的，改它没有功能收益，只有风险。留作**第二份实现，已知且已记录**。

## 5. 契约（增量）

- `xml-range.ts` 新增 `attributeReplacements(xml, element, name, value)`：值相同返回空；`value` 为 `undefined` 时删除该属性（不存在则返回空）；存在则只替换引号内的内容，保留引号字符；不存在则在元素名之后插入 `name="value"`。
- `fill-patch.ts` 不再导出 `attributeReplacements`（改为从 `xml-range.ts` 导入并转发给 `sameKindFillPatches`）。
- `theme-writeback.ts` 删掉私有的 `attributeReplacement`。
- 对外行为：源包用单引号写 `w`/`cap`/`cmpd`/`algn`/`blurRad`/`dist`/`dir`/`prst` 时，改这些值不再产生重复属性。

## 6. 验证

`packages/pptx-export/src/attribute-quotes-writeback.test.ts`：

- 单引号 `a:ln`（`w`/`cap`/`cmpd`/`algn` 四个都单引号）改线宽与端点 → 只替换引号内的值，**引号仍是单引号**，没有重复属性，且把输出喂回 `importPptx` 读到的是新值
- 单引号 `a:pattFill/@prst` 改预设 → 同上
- 单引号 `a:outerShdw` 改 `blurRad` → 同上
- 源包本来没有 `w` → 属性按既有行为插到元素名之后（双引号）
- 模型撤掉线宽 → 单引号的 `w` 被删掉（此前只删双引号的，单引号的留在原地，等于编辑丢失）
- 双引号的既有路径逐条不变（回归）

区分力：把共享实现的引号分支退回只认双引号，上面五条里四条标红。

## 7. 已知限制

- **`master-layout-writeback.ts` 仍有第二份属性补丁实现**（决策 5），它是对的，但两份仍会各自漂移。
- **主题的颜色节点仍整块替换**：`a:sysClr/@val` 会被写成硬编码的 `windowText`，颜色节点上未建模的属性会丢，slot 里放 `a:hslClr` 会得到两个颜色子元素，源包里读不出的颜色让整个导出抛错。四条都已实测，是下一刀。

## 8. 实现记录（2026-09-06）

实现提交 `3f26c5c`。按设计执行，三处偏差：

**共享实现顺手修掉了「值不转义」**：`fill-patch.ts` 那一份写值时不转义，主题那一份转义。合并到主题的做法上（`escapeXml`），所以 `prst`/`cap` 这类枚举词行为不变，而带 `&` 的值不会再写出坏 XML。`xml-range.ts` 因此 import `text-xml.ts` —— 两个模块此前都是叶子，方向上不成环。

**「值相同就不写」的判据收成一行**：`value === source` 覆盖了「两边都是 `undefined`」，旧的那句 `value === source || (value === undefined && source === undefined)` 后半段是多余的。注意 `element.attributes[name]` 是扫描器解码过的值，所以比较用未转义的模型值是对的，写出时才转义。

**主题的 `typeface` 比较必须留在调用点**：它按 `.trim()` 比（导入端会 trim），而共享实现按精确字符串比。少了那一行，源里写 `typeface=" 宋体 "` 的主题会被判成变了。既有测试 `returns the exact source when the modeled typefaces match, whitespace aside` 就是钉这个的。

区分力（实测）：把共享实现的引号分支退回只认双引号 → 7 条里 4 条标红，与设计预估一致。

门禁：2083 项测试、全量 typecheck、全量 build、包边界检查、7 个 e2e 全绿。

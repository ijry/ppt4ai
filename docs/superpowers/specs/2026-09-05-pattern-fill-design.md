# 图案填充（`a:pattFill`）设计

> 状态：待实现
> 日期：2026-09-05

## 1. 目标

让 `a:pattFill`（54 个预设图案，各带前景色与背景色）进入模型、能被看见、写回文件。今天这类填充**整块丢失**，而且与 `a:path` 修复前完全同构：形状不是退化成纯色，而是**没有填充**。

## 2. 探针结果（实测）

探针文件已删除（`pattern-probe.test.ts`、`pattern-probe2.test.ts`）。三个问题各自实测：

**① 元素侧：`a:pattFill` 的形状没有 `fill` 字段**

同一个形状，只换填充节点：

```
pattern → fill = null，元素的键是 ["id","kind","bounds","text","preset","body","placeholder"]
solid   → fill = { color: { type: "srgb", … } }
```

`fill` 这个键**根本不存在**。`parseDirectFill`（`importer.ts:451`）只认 `solidFill` 与 `gradFill`，其余返回 `undefined`。后果不是「颜色不准」而是「形状看不见」—— 与 `a:path` 那刀修掉的是同一类损坏，比退化成纯色更糟。

**② 主题侧：`fillStyleLst` 的图案条目变成 `null`**

一个 `solidFill` 条目加一个 `pattFill` 条目：

```
[ { color: { type: "scheme", … } }, null ]
```

于是 `fillRef idx="2"` 指向图案条目的形状解析不到任何填充。

**③ 无源导出：不写任何填充元素**

一个没有 `fill` 的形状经 `createPptx` 写出的 `spPr` 是：

```xml
<p:spPr><a:xfrm>…</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
```

没有填充节点。所以「导入 → 无源导出」这条路把 `pattFill` 从文件里**彻底抹掉**。

**④ 源包写回不丢**：`writeback.ts:268` 与 `master-layout-writeback.ts:7` 的 `fillNodeNames` 都含 `pattFill`，因此源包路径把该节点作为未建模内容原样保留。文件层面只有无源导出会丢 —— 这与 EMF 的情形同构。

## 3. 关键决策

**决策 1：`pattern` 作兄弟字段，`color` 同时承载前景色**

沿用 `gradient` 与 `pictureFill` 已经确立的兄弟字段形态：

```ts
export interface PatternFill {
  /** `@prst`，逐字保存。54 个 ST_PresetPatternVal 词，模型不裁剪。 */
  preset: PresetPattern
  /** `a:fgClr`。同时镜像进 Fill 自己的 `color`，因此只读 `color` 的消费者退化成前景纯色而不是无填充。 */
  foreground: Color
  /** `a:bgClr`。 */
  background: Color
}
```

`color` 承载前景色这一条是本刀的**要点**：`gradient` 那刀用 `color` 承载第一个停靠点，同一条纪律 —— 任何只认 `color` 的旧消费者（命中测试、缩略图、导出的降级分支）立刻从「看不见」变成「看得见且颜色对得上大半」，不需要逐个改。

**决策 2：`PresetPattern = string`，另设 `PAINTED_PRESET_PATTERNS` 白名单**

照抄 `PresetGeometry` 的处置（`model/index.ts:7,38`）：类型是开放字符串，模型的职责是保住这个词而不是执行枚举；能画的那些词单列一个常量，可测、可查。理由与那刀逐字相同 —— 枚举表长、有版本、此处无法核实，而**改写这个词就是损坏用户的文件**。

**决策 3：本刀只画成前景纯色，真实纹理留作下一刀**

真实图案要 `createPattern` + 一张离屏 tile，而三条绘制路径里有一条在 worker 里（`thumbnail-worker.ts`），那里没有 `document.createElement('canvas')`，得走 `OffscreenCanvas`。那是独立的渲染问题，与「数据进模型、能写回」这件事没有耦合。

因此本刀的绘制结果是**前景纯色**，由决策 1 的 `color` 镜像自动得到，三条绘制路径**一行都不改**。下一刀再做 tile。这样切的好处是每刀都能单独验证：本刀验「不再丢数据、不再看不见」，下一刀验「纹理对不对」。

**已知的代价写进限制**：`pct5` 与 `pct90` 在画布上目前一模一样（都是前景纯色），背景色只存不画。

**决策 4：导出按 `CT_PatternFillProperties` 的序列写**

`a:pattFill` 是 `@prst` 属性 + `a:fgClr` + `a:bgClr` 两个子元素，顺序固定。写在 `solidFill`/`gradFill` 的同一个位置（它们在 `EG_FillProperties` 里是 choice，只能出现一个）。

**决策 5：主题条目复用同一个解析器**

`parseThemeFillStyleEntries` 与 `parseDirectFill` 走同一条路，因此主题的图案条目自动不再是 `null`，`fillRef` 能取到前景色 —— 与 `a:path` 那刀让主题渐变条目一并生效是同一个做法。

## 4. 契约（增量）

`@ppt4ai/model`：新增 `PatternFill` 接口与 `PresetPattern` 类型别名；`Fill` 与 `ResolvedFill` 新增 `pattern?`；新增 `PAINTED_PRESET_PATTERNS`（本刀为空数组，下一刀填充）；`validateFill` 校验 `pattern`（`preset` 是非空 OOXML 词，两个颜色各自过 `validateColor`）。

`@ppt4ai/pptx-import`：`parseDirectFill` 增加 `pattFill` 分支，`color` 取前景色。

`@ppt4ai/render`：`resolvedFillPattern` 把两个颜色过主题解析后挂到 `ResolvedFill.pattern`（`phClr` 在主题条目里要能替换）。

`@ppt4ai/pptx-export`：`standalone-xml.ts` 的填充序列化增加 `a:pattFill` 分支；主题 `fmtScheme` 的填充条目同样。

绘制层与源包写回**不改**。

## 5. 验证

- 导入：`pattFill` 的形状 `fill.pattern` 三个字段齐全，`fill.color` 等于前景色
- 导入：未知 `prst` 词逐字保存
- 主题：`fillStyleLst` 的图案条目不再是 `null`，`phClr` 前景色经 `fillRef` 解析成实色
- 无源导出：写出 `<a:pattFill prst="…"><a:fgClr>…</a:fgClr><a:bgClr>…</a:bgClr></a:pattFill>`
- 往返：`createPptx` → `importPptx` 三个字段逐字相等
- 源包写回：带 `pattFill` 的源包在只改 bounds 后仍保留原节点（固定既有行为，防回归）
- 校验：`preset` 为空串、颜色非法各自被拒

## 6. 已知限制

- 画布上是前景纯色，不是纹理；`pct5` 与 `pct90` 目前视觉相同，背景色只存不画（下一刀补）
- `PAINTED_PRESET_PATTERNS` 本刀是空数组，存在的意义是让下一刀有个明确的落点
- `a:pattFill` 出现在表格单元格与幻灯片背景上的情形本刀不覆盖（走的是不同的解析入口），单列后续切片

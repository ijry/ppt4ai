# 复合线型与描边对齐（`a:ln/@cmpd`、`@algn`）

> 状态：待实现
> 日期：2026-09-05

## 1. 目标

让 `a:ln/@cmpd`（复合线型：单线、双线、粗细、细粗、三线）与 `@algn`（描边相对路径的对齐）进入模型并从无源导出写出，**不再把用户的双线边框改写成单线**。

## 2. 探针结果（实测）

探针已删除。同一个 `<a:ln w="76200" cmpd="dbl" algn="ctr">` 走三条路：

| 路径 | 结果 |
|---|---|
| 导入后模型的键 | `["id","kind","preset","bounds","stroke","strokeWidth"]`——**两个属性都不在** |
| 源包写回（只改 bounds） | `<a:ln w="76200" cmpd="dbl" algn="ctr">…`——**原样保留** |
| 无源导出 | `<a:ln w="76200"><a:solidFill>…`——**两个属性都丢** |

损失只在无源路径，与 `a:pattFill` 建模前的情形同构，也与预设虚线词、预设几何词那两刀修掉的是同一类损坏：**导出改写了用户的文件**。一个双线边框变成单线，不是渲染近似，是文件内容被改。

源包写回之所以不丢，是因为它逐属性打补丁而从不重写整个 `<a:ln>`（`writeback.ts:491` 的注释正是为此存在）。

## 3. 关键决策

**决策 1：两个属性逐字进模型，绘制不变**

```ts
/** `a:ln/@cmpd`, verbatim. */
export type StrokeCompound = 'sng' | 'dbl' | 'thickThin' | 'thinThick' | 'tri'

/** `a:ln/@algn`, verbatim. */
export type StrokeAlign = 'ctr' | 'in'
```

`ShapeElement`/`TextElement` 各加 `strokeCompound?`、`strokeAlign?`；`ThemeLineStyle` 加 `compound?`、`align?`（主题条目与元素侧对称，`cap`/`join` 那刀已建立这个惯例）。

**画布仍画单线**，理由写在下面。这刀是纯数据保真：修的是「导出改写文件」，不是「画得不像」。

**决策 2：为什么不画复合线**

canvas 没有复合描边。要画双线得把路径向内外各偏移半个间距，那是路径偏移算法（`a:custGeom` 的任意路径都要支持），不是这刀能顺带做的。

可以取巧的做法有两种，都不采纳：
- 描两次，第二次用 `destination-out` 挖掉中间——会连带擦掉底下已经画好的填充与阴影，副作用越出描边本身
- 描一次粗的再描一次细的、细的用背景色——描边没有「背景色」这个概念，形状背后可能是任何东西

因此老实画单线，并把「`dbl` 与 `sng` 视觉相同」写进已知限制。这与 `a:pattFill` 第一刀（先建模、绘制留后）是同一个切法。

**决策 3：`algn` 的语义只保存不解释**

`ctr`（描边中心压在路径上）是 canvas 的默认行为，因此 `ctr` 与不声明画出来完全一样。`in`（描边整体落在路径内侧）需要把路径向内偏移半个线宽——同样是路径偏移问题。

保存它的价值仍然成立：无源导出不再丢，往返可逆。

**决策 4：写回逐属性打补丁，照 `lineCapReplacements` 抄**

`cap` 已经有一份完整实现（`writeback.ts:473`）：读源属性、比较、按需插入/替换/删除，用正则定位属性而不重写整个开标签。`cmpd` 与 `algn` 各来一份同构的。

不这样做的后果不是「不生效」而是「不一致」：模型现在会持有源包的值，若写回不认这两个属性，用户改了 `cmpd` 也写不出去，而 `cap` 能——同一个 `<a:ln>` 上两种行为。

## 4. 契约（增量）

`@ppt4ai/model`：`StrokeCompound`、`StrokeAlign` 两个类型；四处字段（元素两处 × 两个属性，主题条目两个）；校验各接受自己的词表。

`@ppt4ai/pptx-import`：`parseStrokeCompound`、`parseStrokeAlign`，与 `parseStrokeCap` 同形；元素路径与主题 `lnStyleLst` 条目都读。

`@ppt4ai/render`：`SceneShapeNode`/`SceneTextNode` 各加两个字段，`shapeStroke` 逐属性回退（元素值 ?? 主题值），与 `cap`/`join` 逐字相同。

`@ppt4ai/pptx-export`：standalone 的 `a:ln` 写出两个属性（`w` → `cap` → `cmpd` → `algn` 的属性顺序，属性顺序在 XML 里无语义，取与 ECMA 文档一致的读法）；`themeLineStyleXml` 同步；writeback 新增 `lineCompoundReplacements`、`lineAlignReplacements`。

绘制层**不改**。

## 5. 验证

`packages/pptx-import/src/compound-line.test.ts`：五个 `cmpd` 词与两个 `algn` 词各自读出；不认识的词丢弃（不进模型而非报错）；主题条目同样读出。

`packages/pptx-export/src/compound-line.test.ts`：
- standalone 写出 `<a:ln w="76200" cmpd="dbl" algn="ctr">`
- 往返：五个 `cmpd` 词逐字回来
- writeback：无关编辑保持字节相同
- writeback：改 `cmpd` 写出新值、删 `cmpd` 移除属性
- **回归**：源包有 `cmpd` 而模型没有时不重写（这是 `a:pattFill` 那刀踩过的坑，这里提前钉住）

`packages/model/src/compound-line.test.ts`：两个词表各自校验，非法词报出带路径的错误。

`packages/render/src/compound-line.test.ts`：元素值优先于主题值，两者都无时字段缺席。

## 6. 已知限制

**画布仍画单线**：`sng`/`dbl`/`thickThin`/`thinThick`/`tri` 视觉相同，`algn="in"` 与 `ctr` 视觉相同。要真画需要路径偏移算法，那是独立切片（且与 `a:custGeom` 的偏移需求重叠，值得一起做）。列入阅读器核对清单。

**`a:miter/@lim` 仍不建模**：与 `cmpd` 同属 `CT_LineProperties` 未覆盖的部分，但它只影响尖角截断，视觉影响远小。

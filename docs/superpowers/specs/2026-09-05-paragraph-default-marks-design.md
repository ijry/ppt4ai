# 段落自身的 `a:defRPr`

> 状态：已实现
> 日期：2026-09-05

## 1. 目标

让段落自己的 `a:pPr/a:defRPr`（模型里的 `attrs.defaultMarks`）从无源导出写出，并让源包写回认得它。

## 2. 探针结果（实测）

探针已删除。一个段落写 `<a:pPr algn="ctr"><a:defRPr sz="3200" b="1"/></a:pPr>`：

| 路径 | 结果 |
|---|---|
| 导入 | `attrs = {align:"center", defaultMarks:{fontSize:32,bold:true}}`——**读得出** |
| 源包写回（只改 bounds） | `<a:pPr algn="ctr"><a:defRPr sz="3200" b="1"/></a:pPr>`——原样保留 |
| 无源导出 | `<a:p><a:pPr algn="ctr"/><a:r>…`——**`a:defRPr` 整个丢掉** |

`serializeParagraphProperties` 有第三个参数 `defaultMarks`，但普通段落那条调用（`text-xml.ts:224`）不传——只有 `a:lstStyle` 的分级默认那条（第 196 行）传。所以段落级的 `a:defRPr` 从来没被写出过。

**源包写回之所以不丢也不是因为它认得**：`sourceParagraphAttrs` 同样不读 `a:defRPr`，于是比较的两侧**都**缺这一项、判为相等，节点因此没被触碰。两处同时漏，恰好互相掩盖。

## 3. 关键决策

**决策 1：两处一起改，否则修一半会造成回归**

只让 `serializeTextBodyXml` 写出 `a:defRPr`，比较的模型侧就多了这一项而源侧仍然没有——于是**每一个用了 `a:defRPr` 的文本框在任何无关编辑后都会被重写**。重写虽然不丢 `defaultMarks` 本身（模型持有它），但会丢掉 `txBody` 里一切未建模的兄弟内容。

这与图案填充那刀的 `sourceFill` 是同一条：**导入端认得的东西，比较端必须也认得**。因此 `sourceParagraphAttrs` 同步读 `a:defRPr`，复用已有的 `sourceRunMarks`。

**决策 2：写在 `a:pPr` 子元素序列的末尾，与分级默认那条一致**

`serializeParagraphProperties` 已经把 `a:defRPr` 放在 children 数组最后（第 181 行），分级默认路径就是这么写出的。段落路径复用同一段代码，因此顺序自动一致。

**决策 3：`a:lstStyle` 那条路径不动**

它一直是对的（传了参数），本刀只补段落这条。

## 4. 契约（增量）

`@ppt4ai/pptx-export`：`serializeParagraphXml` 把 `paragraph.attrs?.defaultMarks` 传给 `serializeParagraphProperties`；`sourceParagraphAttrs` 读 `a:defRPr`。

模型、导入、渲染、绘制**不改**——`defaultMarks` 早已建模、早已被 `resolveRunMarks` 合并。

## 5. 验证

`packages/pptx-export/src/paragraph-default-marks.test.ts`：
- standalone 写出 `<a:pPr algn="ctr"><a:defRPr sz="3200" b="1"/></a:pPr>`
- 往返：`defaultMarks` 逐字回来
- 缺席时不写 `a:defRPr`
- **回归**：带 `a:defRPr` 的源包在只改 bounds 时字节相同（决策 1 的那个陷阱）
- writeback：改 `defaultMarks` 后新值写出
- writeback：删 `defaultMarks` 后节点移除

## 6. 已知限制

**`a:defRPr` 的内容仍只覆盖 `TextMarks` 那九项**：与 run 级 `a:rPr` 同一份序列化器，因此支持面完全相同，未建模的属性两处一起缺。

## 7. 实现记录（2026-09-05）

实现提交 `待填`。两处各一行，按设计执行。

**决策 1 的陷阱经过实测确认**：把 `sourceParagraphAttrs` 里读 `a:defRPr` 那两行删掉（只留写出那半），七条测试里两条立刻标红——「只改 bounds 时 `txBody` 不变」与「删掉 `defaultMarks` 后节点移除」。前者正是重写会毁掉的 `a:extLst`。

**这个缺口是怎么找到的，值得记**：不是猜的，是拿 进度.md 里「run marks、段落属性、body 属性现已完整往返」这句话去核对。核对方法是把模型字段名逐个 grep 三个文件（`importer.ts`、`text-xml.ts`、`text-source.ts`），看有没有一侧计数为零——`defaultMarks` 在 `text-source.ts` 里是 0。**第一个假设（比较盲区导致无谓重写）是错的**：探针显示未编辑时字节相同，因为写出那半也漏了，两处同时漏、恰好互相掩盖。查下去才发现真正丢的是无源导出。

grep 计数是个粗糙但有效的信号：它给出的是「值得去探针的地方」，不是结论。

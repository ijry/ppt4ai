# 幻灯片背景源包写回设计

> 状态：设计
> 日期：2026-09-04

## 1. 目标

让编辑过的幻灯片背景写进**源包**。上一刀（幻灯片背景编辑）给背景加了 engine 命令与面板，依据是「模型、解析、绘制、写出四层都已就绪」—— 那句话对 standalone 成立，**对源包写回不成立**：`writeback.ts` 里 grep `p:bg` 零命中。于是改过背景再连同源包导出，编辑被静默丢弃，正是描边宽度那刀总结过的「模型能持有导出端拒绝写出的值就等于静默丢编辑」。

## 2. 探针结果（实测）

源包里一页带 `p:bg` 纯色（`1F3864`），把模型背景改成 `FF0000` 后连源包导出；另一组源包完全没有 `p:bg`（`bg-writeback-probe.test.ts`，已删除）：

```
has p:bg  imported={"fill":{"color":{"type":"srgb","v":"1F3864"}}}
has p:bg  written =<p:bg><p:bgPr><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
no p:bg   imported=undefined
no p:bg   written =(none)
```

**写出的还是旧颜色**；源包没有 `p:bg` 时新背景一个字节都没写。

## 3. 关键决策

**决策 1：只改填充节点，保住 `p:bgPr` 的其余内容**

源 `p:bgPr` 里可能有 `a:effectLst` 与我们不建模的兄弟节点。因此颜色变化只替换 `p:bgPr` 内的**那个填充节点**（`a:solidFill`/`a:gradFill`/…），与元素填充写回同一条路子；只有在结构必须变时（源是 `p:bgRef` 而模型是填充，或反之）才替换整个 `p:bg`。

**决策 2：源包没有 `p:bg` 时插在 `p:spTree` 之前**

`CT_CommonSlideData` 的顺序是 `p:bg`、`p:bgPr`…、`p:spTree`，所以插入点是 `p:spTree` 的起点，前缀取源文件自己的（`p:` 不是保证）。

**决策 3：清空背景就删掉 `p:bg` 节点**

`setSlideBackground(null)` 的语义是「回落到 layout/master」，而 OOXML 里那正是「本页没有 `p:bg`」。删节点比写一个空 `p:bgPr` 更贴近语义，也不会留下一个继承链上多余的空壳。

**决策 4：比较用镜像读取，与颜色/虚线各刀同款**

新增 `sourceBackground(bg)` 读出源背景（`p:bgPr` 的填充或 `p:bgRef` 的 idx+颜色），与模型比较；相等就不产生任何 replacement，因此**未编辑的包逐字节不变**。

## 4. 契约（增量）

`@ppt4ai/pptx-export`：`replaceSlideTables` 新增背景 replacement；新增 `sourceBackground` 镜像与 `serializeBackgroundNode`。

## 5. 测试策略

- **改颜色**：只替换填充节点，`a:effectLst` 与未知兄弟节点逐字保留
- **加背景**：源包无 `p:bg` 时插在 `p:spTree` 之前，且能重新导入
- **清背景**：`p:bg` 节点被删除
- **换结构**：源 `p:bgRef` 改成纯色时整节点替换；源纯色改成 `bgRef` 同理
- **渐变**：渐变背景写出并能重新导入
- **未编辑**：逐字节不变（含 `bgRef` 与无背景两种源）
- **回归**：现有 1636 项

## 6. 已知限制

- `p:bgPr` 的效果列表仍不建模（只是被保留），因此无源生成写的仍是空 `a:effectLst`
- layout/master 的背景仍不可编辑，也不写回
- 背景的图片填充（`p:bg` 里的 `a:blipFill`）仍不建模：源包里它会被当作「没有可表达的背景」而保留原节点，但模型里看不见它

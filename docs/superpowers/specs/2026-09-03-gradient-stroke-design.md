# 渐变描边绘制设计

> 状态：已实现（2026-09-03，待填）
> 日期：2026-09-03

## 1. 目标

让渐变描边真的画成渐变。这是描边颜色命令的前置条件 —— 上一刀（`270644a`）明确推迟了颜色命令，理由就是「绘制端只用 `resolvedStrokeColor`，现在加命令会让 UI 能设一个画不出来的值」。

## 2. 探针结果（实测）

一个 `<a:ln w="76200">` 里放两停靠点渐变（`4472C4` → `ED7D31`，`ang="0"`）的形状，导入后：

```
element : {…,"stroke":{"color":{"type":"srgb","v":"4472C4"},"gradient":{"stops":[…两个…],"angle":0,"scaled":false}},"strokeWidth":76200}
```

**模型里渐变描边已经完整** —— 这是线性渐变那刀免费带来的：`parseStroke` 走 `parseDirectFill`，而后者从那刀起认识 `gradFill`。

缺口只在场景与绘制两层：场景没有 `resolvedStrokeGradient`（`grep` 只有 `resolvedStrokeColor`），绘制端 `shape-painting.ts:137,172` 拿 `stroke.style` —— 一个纯色字符串。于是**蓝到橙的渐变轮廓画成纯蓝**（第一个停靠点）。

## 3. 关键决策

**决策 1：与填充完全对称，复用同一个 `fillGradient` 辅助函数**

`resolvedStrokeGradient` 挨着 `resolvedStrokeColor`，正如 `resolvedFillGradient` 挨着 `resolvedFillColor`。绘制端把 `context.strokeStyle` 设成 `CanvasGradient` 而不是颜色字符串 —— canvas 的 `strokeStyle` 与 `fillStyle` 接受同样的类型，所以不需要第二套逻辑。

轴用**同一个包围盒**：描边沿形状边界走，渐变跨越整个形状的包围盒，与填充一致。因此 `fillGradient(context, gradient, mappedBounds)` 原样复用，只是赋给 `strokeStyle`。

**决策 2：`resolvedStrokeColor` 保持设置，作为平色后备**

与填充同款：只读颜色的消费者（以及渐变解析失败时）仍拿到第一个停靠点。停靠点 < 2 时不产出渐变字段，绘制回落到平色 —— 这条规则在场景层只写一处，填充与描边共用。

**决策 3：`paintPathFills` 也要接渐变描边，不只是 `paintShapeNode`**

`paintPathFills` 由 `paintTextNode` 调用，所以带文字的形状（`roundRect` 标注框那类）同样要能画渐变轮廓。两处都改，否则「形状能、带字的形状不能」会是个隐蔽的不一致。

**决策 4：导入、导出、写回预期一行不改 —— 但要用测试确认，不是假设**

- 导入：探针已证实模型里就有
- standalone：`serializeShapeXml` 写 `<a:ln>${serializeFillXml(element.stroke)}`，而 `serializeFillXml` 从渐变那刀起在有 `gradient` 时写 `gradFill`
- 写回：`strokeReplacements` 的填充节点比较走 `sourceFill(fillNode)`，那个函数从渐变那刀起认识 `gradFill`

三条都是**推断**，所以三条都加断言。上一刀「命令 → 导出」的覆盖缺口教训是：不能把「应该已经可以」当成已验证。

## 4. 契约（增量）

`SceneShapeNode`/`SceneTextNode` 新增 `resolvedStrokeGradient?: ResolvedGradient`。

`paintPathFills` 的 `colors` 参数新增 `strokeGradient?`/`strokeBounds?`，与既有的 `fillGradient`/`fillBounds` 对称。

## 5. 测试策略

- **场景**：渐变描边逐停靠点解析（含主题色与 alpha）；`resolvedStrokeColor` 仍是第一个停靠点；纯色描边不产生渐变字段；停靠点 < 2 时退化
- **绘制**：`createLinearGradient` 收到轴端点、`strokeStyle` 是那个 gradient；带文字的形状同样；纯色描边不调 `createLinearGradient`
- **导出**：standalone 写出 `<a:ln>` 里的 `gradFill` 并能重新导入拿回同一模型（确认决策 4）
- **写回**：未编辑的渐变描边形状导出后逐字节不变；只改宽度时 `gradFill` 逐字保留（确认决策 4）
- **回归**：现有 1297 项测试

## 6. 已知限制

- `a:path` 径向描边仍不建模（与填充同款限制）
- 渐变描边没有命令与控件 —— 但这一刀之后颜色命令不再会设出画不出来的值
- 表格边框（`TableBorder`）只有 `color`，不带渐变，本刀不涉及
- 虚线 + 渐变同时存在时，虚线图案用渐变绘制，各段颜色按其在轴上的位置取 —— 这是 canvas 的自然行为，未与阅读器比对

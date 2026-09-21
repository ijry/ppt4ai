# 描边宽度与线型命令设计

> 状态：已实现（2026-09-03，`270644a`）
> 日期：2026-09-03

## 1. 目标

给 engine 加 `setElementStrokeWidth` 与 `setElementStrokeStyle` 两条命令，让描边宽度与线型第一次可编辑。写回已在上一刀（`d93e36c`）就绪，所以命令不会带着「编辑会消失」的行为发布。

## 2. 当前状态（实测）

`grep "type: 'set"` 在 `packages/engine/src/index.ts` 命中九条，**没有一条与元素描边相关**：

```
setImageRotation / setElementRotation / setTableCellText / setTextBody
setTableCellFill / setTableCellBorders / setThemeColor / setThemeFont
```

`setTableCellFill` 只作用于表格单元格。**元素自己的 `fill`/`stroke`/`strokeWidth`/`strokeStyle` 一个都没有命令** —— 只能靠导入进入模型，宿主直接改文档才能变，而那条路径不进 undo 栈。

## 3. 关键决策

**决策 1：一条命令管一个属性，与 `setThemeColor` 同形，不做聚合的 `setElementStroke`**

```ts
| { type: 'setElementStrokeWidth'; elementId: string; width: number | null }
| { type: 'setElementStrokeStyle'; elementId: string; style: StrokeStyle | null }
```

用户面前是三个独立动作（选颜色、选粗细、选线型），每个该是**独立的一次 undo**。聚合成 `setElementStroke({ color?, width?, style? })` 会让「只改粗细」的 undo 记录里带着颜色与线型 —— `setThemeColor` 一次只写一个槽位正是同一条理由。

**否决现在就做颜色命令**：`stroke` 的类型是 `Fill`，而 `Fill` 从渐变那刀起带 `gradient`，所以颜色命令要先决定「命令能否设渐变描边」。而绘制端只用 `resolvedStrokeColor`（渐变描边会画成第一个停靠点，已写进渐变那刀的限制），先加命令会让 UI 能设一个画不出来的值。颜色命令因此是独立一刀，且应排在渐变描边绘制之后。

**决策 2：`null` 清除字段，与写回的「模型无值就删属性」严格对应**

`width: null` → `delete element.strokeWidth`，导出时 `w` 属性被删除、宽度回到主题继承。`style: null` → `delete element.strokeStyle`，`prstDash` 被删除、线型回到 solid。

这不是发明的语义：它就是上一刀写回已经实现的那条。命令与导出端说同一句话，所以「设成 null 再导出」的结果可预测。

**决策 3：`width: 0` 与 `width: null` 是两回事，命令必须都接受**

OOXML 里 `w="0"` 是明确的发丝线、省略 `w` 是继承主题。上一刀的写回已经区分它们，命令层不能把 `0` 当成「清除」—— 否则模型永远表达不出显式发丝线。

**决策 4：只接受 `shape` 与 `text` 两种 kind**

`strokeWidth`/`strokeStyle` 只声明在 `ShapeElement` 与 `TextElement` 上。`image`/`table`/`group` 传进来抛稳定错误，与 `setElementRotation` 对 `image` 的处理同款（那里是分流，这里是拒绝，因为没有对应字段可写）。

**决策 5：校验在 clone 上跑，无变化不入 undo 栈**

与 `setThemeColor` 同款：先 clone、改、`validateDocument`，失败则抛错且原文档不被部分修改。值与现状相同时不产生 patch —— 否则工具栏每次点同一个值都塞一条 undo。

## 4. 契约（增量）

`EditorCommand` 增加两个变体。`applyCommand` 增加两个 case。无对外类型变化以外的 API 变动。

## 5. 测试策略

- **宽度**：设值进模型并可 undo；`0` 保留为 `0`；`null` 删除字段；非整数与负数抛稳定错误；相同值不入 undo 栈
- **线型**：三个合法词各能设；`null` 删除字段；非法词抛错
- **kind**：`image`/`table`/`group` 抛稳定错误；不存在的元素抛稳定错误
- **回归**：现有 1283 项测试

**「命令 → 导出」的端到端测试放不下，实现期才发现**：`@ppt4ai/pptx-export` **不依赖** `@ppt4ai/engine`（`check:boundaries` 守着这条），而全仓**没有任何包同时依赖两者**。所以这条链只能由两侧各自覆盖：engine 测试盖「命令 → 模型」，`stroke-writeback.test.ts` 盖「模型 → 字节」，两者在一个有类型的接口上对接。第一版试图把端到端测试写进 pptx-export，被包边界正确地拦下了，已删除。

## 6. 已知限制

- 没有工具栏控件，命令只能从代码调用 —— UI 是独立一刀（项目在主题面板上走的正是「命令 → headless 控制器 → `.vue`」三步）
- 没有 `setSelectionStrokeWidth` 之类的多选变体，工具栏要作用于选区时需要它（`rotateSelection` 是既有先例）
- **描边颜色仍无命令**（决策 1 的第二段），且它应排在渐变描边绘制之后
- 元素的 `fill` 也仍无命令，同一类缺口
- `ElementDefaults`（layout/master 占位符）不带宽度线型，所以命令不作用于继承来的描边
- **「命令 → 导出」无端到端测试**，理由见上（包边界），这是本刀接受的覆盖缺口

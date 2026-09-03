# 元素填充与描边命令设计

> 状态：已实现（2026-09-03，待填）
> 日期：2026-09-03

## 1. 目标

给 engine 加 `setElementFill` 与 `setElementStroke`，让元素自己的填充与描边**颜色**第一次可编辑。上一刀（`f273274`）让渐变描边真的画出来，消掉了颜色命令的前置障碍。

## 2. 当前状态（实测）

上一刀记录里写着：「元素的 `fill` 也仍无命令，同一类缺口」。加上宽度与线型两条命令后，元素描边仍缺颜色，填充则完全无命令。

## 3. 关键决策

**决策 1：命令收整个 `Fill`，不是只收 `Color`**

```ts
| { type: 'setElementFill'; elementId: string; fill: Fill | null }
| { type: 'setElementStroke'; elementId: string; stroke: Fill | null }
```

`Fill` 从渐变那刀起带 `gradient`，所以收 `Fill` 让「设纯色」与「设渐变」是同一条命令。字段名与模型逐字对应（`fill`/`stroke` 对 paint，`strokeWidth`/`strokeStyle` 对几何），所以三者读起来不会混。

**这一刀现在才安全**：上一刀之前绘制端只用 `resolvedStrokeColor`，命令能设一个 canvas 忽略的渐变。顺序与「写回先于命令」同一条纪律。

**决策 2：设纯色替换整个 `Fill`，渐变被丢掉**

在有渐变的形状上设一个纯色，`gradient` 随之消失 —— 这正是「选了纯色」的含义，PowerPoint 也如此。**否决「只改 `color` 保留 `gradient`」**：那会让颜色选择器在渐变形状上产出一个「第一个停靠点变了但 ramp 还在」的状态，用户看到的和选的不是一回事。

**决策 3：`null` 删除字段，与写回既有行为对应**

`fillReplacements`/`strokeReplacements` 在模型无 paint 而源有时写 `<a:noFill/>`（描边）或删除填充节点（填充）—— 那条早已实现并有测试。命令的 `null` 走的就是它。场景侧则回落到 `styleRef` 的主题引用。

**决策 4：一个私有实现服务两条命令，字段名由调用方给**

`fill` 与 `stroke` 都是 `Fill`、校验相同、可接受的 kind 相同，所以 `setElementPaint(elementId, field, paint)` 一份实现。两条命令仍是**两条**，因为它们是两个用户动作、各该一次 undo。

**决策 5：存进模型前 clone**

命令收到的对象若直接存，宿主之后改它就会绕过 history 改文档。既有命令对 `TextBody` 等结构做的就是 clone，这里照办，并加断言钉住。

## 4. 本刀被迫连带修的两处校验（都是本刀让它们变得可达）

**① 元素 `fill`/`stroke` 从未进过 `validateDocument`** —— 渐变那刀发现并记为「非本刀引入、不在本刀范围」，理由是没有任何路径能放进畸形值。**加了命令之后那个理由消失了**，所以本刀补上：`validateFill` 现在也作用于元素的两个 paint 字段。补完后全量测试仍绿，说明既有夹具本来就是合法的。

**② `validateColor` 不检查 `srgb`/`system` 的十六进制** —— 只查 `type` 在集合里、`v` 非空。而绘制端 `colorStyle` 对非六位十六进制**抛错**。于是命令可以把文档放进「校验通过但一画就崩」的状态。本刀补上这条检查。

两条都是「本刀开了一扇门，所以本刀负责门后的安全」，不是顺手扩大范围。

## 5. 测试策略

- **填充**：设纯色/渐变并可 undo；纯色替换渐变；`null` 删除字段；畸形颜色与单停靠点渐变抛稳定错误；相同值不入 undo 栈；存进去的对象是 clone
- **描边**：设颜色与渐变；`null` 清除；**不动 `strokeWidth`/`strokeStyle`**
- **kind**：`image`/`table`/`group` 与不存在的元素抛稳定错误
- **校验**：两个字段各自接受合法 paint、拒绝畸形颜色、拒绝非六位十六进制、拒绝单停靠点渐变
- **回归**：现有 1313 项测试

## 6. 已知限制

- 仍无工具栏控件；三个描边属性与填充现已全部可编程编辑，UI 是独立一刀
- 无多选变体（`setSelectionFill` 之类）
- `<a:ln><a:noFill/></a:ln>` 与「根本没有 `a:ln`」在导入端都收敛成「无 `stroke`」，所以命令无法表达「显式无轮廓」与「继承主题」的区别 —— 既有限制，非本刀引入
- `a:path` 径向渐变仍不建模，所以命令也设不出它

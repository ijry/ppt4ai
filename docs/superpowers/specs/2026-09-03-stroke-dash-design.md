# 形状虚线描边设计

> 状态：已实现（2026-09-03，`5a90134`）
> 日期：2026-09-03

## 1. 目标

让 `<a:ln><a:prstDash>` 进入模型并影响画布线型。上一个切片（描边宽度）在「已知限制」里点名了 `prstDash` 仍不建模、虚线形状画成实线 —— 本切片补掉它。

## 2. 探针结果（实测）

同一页放四个形状，同色同宽（`w="38100"`），只有 `prstDash` 不同：

```
no prstDash : {"id":"el_1",…,"stroke":{"color":{"type":"srgb","v":"203864"}},"strokeWidth":38100}
solid       : {"id":"el_2",…,"stroke":{"color":{"type":"srgb","v":"203864"}},"strokeWidth":38100}
dash        : {"id":"el_3",…,"stroke":{"color":{"type":"srgb","v":"203864"}},"strokeWidth":38100}
dot         : {"id":"el_4",…,"stroke":{"color":{"type":"srgb","v":"203864"}},"strokeWidth":38100}
```

**四个模型逐字相同** —— `prstDash` 被丢掉了。绘制端也从不调 `setLineDash`（grep 在 `shape-painting.ts` 零命中），所以源文件写虚线还是点线，画布上都是实线。

对照组：表格边框**早就**有 `dash`/`dot`（`table-painting.ts:81` 的 `dashPattern`、`table-painting.test.ts:200` 的断言）。所以这不是「画不出虚线」，而是形状这条路径没接上表格已有的能力。

## 3. 关键决策

**决策 1：`StrokeStyle` 只收三个词，OOXML 的十一个词往里收敛**

```ts
export type StrokeStyle = 'solid' | 'dash' | 'dot'
```

ECMA-376 的 `ST_PresetLineDashVal` 有 `solid` `dot` `dash` `lgDash` `dashDot` `lgDashDot` `lgDashDotDot` `sysDash` `sysDot` `sysDashDot` `sysDashDotDot` 十一个。**不逐一建模**：绘制端只有一条虚线图案和一条点线图案，多存的词无处可画，只会让模型声明自己支持它其实不支持。收敛规则写在导入端一处：`dot`/`sysDot` → `dot`，其余非 `solid` → `dash`。

代价明确：`dashDot` 这类混合图案画成纯虚线，往返也退化成 `dash`。**这是本切片故意付的代价**，不是漏洞。

**决策 2：`solid` 不进模型，只有非实线才落字段**

`solid` 是缺省态。若把它写进模型，每个有轮廓的形状都会多一个 `strokeStyle:"solid"` 字段 —— 既让既有测试的 `toEqual` 全部失效，也让「模型只记源文件说过的话」这条不变量破掉（源里没写 `prstDash` 与写了 `val="solid"` 在渲染上等价，模型不必区分）。因此导入端把两者都归为「无字段」。

**决策 3：`dashPattern` 从 table-painting 提到 shape-painting，两边共用**

表格那份的签名是 `Exclude<NonNullable<TableBorder['style']>, 'none'>`，展开正是 `'solid' | 'dash' | 'dot'`，与 `StrokeStyle` 逐字相同 —— 本就是同一个概念的两处拼写。依赖方向也顺：`table-painting → text-painting → shape-painting` 已经成立，再加一条 `table-painting → shape-painting` 不成环。

**否决了「各留一份」**：两份 4:3 与 1:2 的比例迟早漂移，而虚线比例漂移在缩略图尺度上几乎看不出来，是最难发现的那类回归。

**决策 4：`lineWidth` 与 `setLineDash` 都无条件设置，不再条件化**

上一个切片写的是 `if (node.strokeWidth !== undefined) context.lineWidth = …`。本切片把它改成「无宽度时取 1」再无条件赋值，因为**虚线图案的长度按线宽换算** —— 若宽度缺席就跳过赋值，图案得用画布当前的 `lineWidth` 反推，而那个值可能是上一个元素留下的。取 1 与「无宽度画发丝线」的既有行为一致（决策见上一切片），同时让图案有确定的基准。

`setLineDash` 同样无条件调用：实线传 `[]` 是显式复位，否则前一个元素的虚线会漏给后一个。`paintShapeNode` 有 `save`/`restore` 兜底，但 `paintPathFills` 没有，它由 `paintTextNode` 直接调用。

**决策 5：写回不需要改，理由与上一切片同源**

`strokeReplacements` 只替换 `<a:ln>` 里的填充节点，从不碰 `prstDash` —— `writeback.test.ts:875` 已经在断言改描边颜色后 `<a:prstDash val="dash"/>` 逐字保留。本切片**不新增写回逻辑**，只确认这条断言现在同时守着一个已建模的字段（此前它守的是纯未建模内容）。

standalone 导出要写 `<a:prstDash val="…"/>`：它是 `a:ln` 的**子元素**、按 ECMA-376 序列排在填充之后，不是属性。`dash`/`dot` 恰好都是合法 `val` 词，模型值原样写出。

## 4. 契约（增量）

`StrokeStyle = 'solid' | 'dash' | 'dot'` 新增到 `@ppt4ai/model`。

`ShapeElement`/`TextElement` 新增 `strokeStyle?: StrokeStyle`，进 `validateDocument`。

`SceneShapeNode`/`SceneTextNode` 新增 `strokeStyle?: StrokeStyle`。

`dashPattern(style, width)` 从 `table-painting` 移到 `shape-painting` 并导出。

## 5. 测试策略

- **导入**：`dash`/`dot` 进 `strokeStyle`；无 `prstDash` 与 `val="solid"` 都不产生字段；`lgDash`/`dashDot`/`sysDash` 收敛为 `dash`，`sysDot` 收敛为 `dot`；带文本的形状同样读到
- **场景**：线型透传到两种节点
- **绘制**：`setLineDash` 按宽度换算（`dash` → `[4w,3w]`、`dot` → `[w,2w]`）；实线传 `[]`；无宽度时基准为 1
- **往返**：standalone 写出 `<a:prstDash>` 并能重新导入；改描边颜色后源 `prstDash` 逐字保留（既有断言）
- **回归**：现有 1102 项测试

## 6. 已知限制

- 十一个 OOXML 词收敛成三个（决策 1），`dashDot` 家族的混合图案退化为 `dash`，往返不可逆
- `a:custDash` 自定义图案完全不建模
- 主题 `lnStyleLst` 条目的线型仍不进形状：`resolveStyleLine` 只解析颜色，只靠 `lnRef` 的轮廓没有线型（与线宽同一缺口）
- `cap`/`cmpd`/`algn`/`join` 仍不建模
- 占位符 `ElementDefaults` 不带线型，从 layout/master 继承的描边只有颜色
- 没有 engine 命令与工具栏控件，线型只读

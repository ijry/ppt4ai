# 线性渐变填充设计

> 状态：已实现（2026-09-03，`b75f4e6`）
> 日期：2026-09-03

## 1. 目标

让 `a:gradFill` 的线性渐变进入模型、画到画布、并从两条导出路径写出去。这是形状保真里被点名过三次的最大一块。

## 2. 探针结果（实测）

一个两停靠点的垂直渐变形状（`4472C4` → `203864` 带 60% alpha，`ang="5400000"`），导入再带一次文本编辑导出：

```
element : {"id":"el_1","kind":"text","bounds":{…},"text":"Graded","preset":"rect","body":{…}}
gradKept: true
spPr    : <p:spPr>…<a:gradFill rotWithShape="1"><a:gsLst>…</a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></p:spPr>
```

两件事同时成立：

1. **模型里根本没有 `fill`** —— `parseDirectFill` 只找 `solidFill`，渐变整块丢掉。画布上什么都不画，而 PowerPoint 画一条蓝到深蓝的渐变。
2. **写回今天能保住渐变，恰恰是因为模型是空的** —— `fillsEqual(undefined, undefined)` 为真，不产生替换，`gradFill` 作为未建模内容原样留着。

## 3. 关键决策

**决策 1：写回必须与读取同刀完成，否则只做读取会静默压平所有渐变**

这不是猜测，是从代码路径读出来的必然结果。`writeback.ts:292` 是：

```ts
const sourceFill = fillNode?.localName === 'solidFill' ? sourceColor(fillNode) : undefined
if (fillsEqual(sourceFill ? { color: sourceFill } : undefined, fill)) return []
if (fill) { const value = serializeFillXml(fill); if (fillNode) return [替换整个 fillNode] }
```

源是 `gradFill` 时 `sourceFill` 永远是 `undefined`。**一旦导入端开始产出 `fill`**，比较必然判「变了」，然后拿 `serializeFillXml` 的 `<a:solidFill>` **覆盖掉整个 `<a:gradFill>`**。于是「导入认识渐变」这一步本身就会把每份被编辑过的 deck 里所有渐变压成纯色 —— 而且没有任何测试会红，因为今天没有测试断言渐变在编辑后仍是渐变。

所以本切片的边界不能划在读写之间。**读写同刀，探针的第 2 条正是它的理由。**

**决策 2：`Fill` 加兄弟字段 `gradient`，`color` 仍必填并承载第一个停靠点**

```ts
export interface Fill {
  color: Color              // 渐变时为第一个停靠点的颜色
  gradient?: Gradient
}
```

**否决把 `Fill` 改成联合类型** `{ type:'solid', color } | { type:'gradient', stops }`：那要动每一处 `fill.color`（导入、场景、绘制、表格、两条导出、写回比较），而本项目已经两次为同样的理由推迟了同类重塑（描边宽度、虚线）。加兄弟字段让**每个只读 `color` 的既有消费者原地不动**。

`color` 取第一个停靠点**不是发明近似值**：它是文件里真实存在的一个颜色，而且对填充而言「用渐变的起始色画平」比「什么都不画」离正确近得多。只读 `color` 的消费者（例如表格单元格填充）因此从「不画」升级为「画平」。

**决策 3：只做线性渐变，`a:path` 保持不建模**

`a:lin` 是主题与绝大多数形状用的形态（Office 内置主题的渐变条目全是 `a:lin`）。`a:path`（`circle`/`rect`/`shape`）的径向形态不建模，`parseDirectFill` 对它**仍返回 `undefined`，与今天完全一致** —— 不改变现有行为，也不给它编一个方向。已知代价写进限制。

**决策 4：停靠点少于两个时退化成纯色，不硬凑渐变**

`gsLst` 里可用停靠点（`pos` 为 0..100000 的整数、颜色可解析）**≥2 才产出 `gradient`**；恰好 1 个时产出 `{ color: 那个停靠点 }` —— PowerPoint 对单停靠点渐变也就是画平；0 个时不产出 `fill`。

**停靠点保持文档顺序，不排序**。OOXML 要求 `pos` 升序，但真按 `pos` 重排会把一个畸形文件静默「修好」，从而掩盖问题；canvas 的 `addColorStop` 不要求有序。

**决策 5：渐变轴的几何进 `@ppt4ai/geometry`，不进绘制层**

`a:lin/@ang` 是「60000 分之一度、屏幕坐标下自 +x 轴顺时针」。轴的两个端点是纯几何：方向 `d`，半跨度 `|w/2·cos θ| + |h/2·sin θ|`，端点为 `中心 ∓ d·半跨度` —— 恰好让渐变覆盖整个包围盒（θ=90° 时端点正是上边中点与下边中点）。

`scaled="1"` 的语义是「角度在形状的单位方格里量再拉伸到包围盒」，等价于方向取 `(w·cos θ, h·sin θ)` 归一化；`scaled="0"` 直接取 `(cos θ, sin θ)`。两者在 θ=90° 时相同，在 45° 且 `w=2h` 时前者正好是包围盒对角线 —— 这是判断实现对不对的那个例子。

**决策 6：主题的渐变条目仍记 `null`，是独立的下一刀**

`parseThemeStyleEntries` 只找 `solidFill`，所以主题 `fillStyleLst` 里的渐变条目**本切片保持 `null` 不变**。要做需要给场景加「已解析的渐变」形态与新的解析函数，与主题线条样式那刀给 `w`/`prstDash` 做的事同构 —— 边界因此自然成立，不需要额外约束。

**决策 7：未建模的渐变属性只在「未编辑」时保住**

`rotWithShape`、`a:tileRect`、`a:gs` 上的扩展等等不建模。渐变**未被编辑**时写回不产生替换、源字节原样保留；一旦填充被改，新写出的 `gradFill` 不带这些属性。与线条 `cap="rnd"` 同一类代价，加断言把「未编辑必须逐字节不变」钉住。

## 4. 契约（增量）

```ts
export interface GradientStop { pos: number; color: Color }
export interface Gradient { stops: GradientStop[]; angle?: number; scaled?: boolean }
export interface Fill { color: Color; gradient?: Gradient }
```

进 `validateDocument`：`stops` 至少两项、`pos` 为 0..100000 的整数、`angle` 为整数。

`ResolvedGradient { stops: { pos: number; color: ResolvedColor }[]; angle?: number; scaled?: boolean }` 与 `SceneShapeNode`/`SceneTextNode` 的 `resolvedFillGradient?`。

`gradientAxis(bounds, angle, scaled)` 新增到 `@ppt4ai/geometry`。

`serializeFillXml` 在 `fill.gradient` 存在时写 `<a:gradFill>`；`fillsEqual` 与源侧提取都认识 `gradFill`。

## 5. 测试策略

- **导入**：两停靠点带 `pos`/`alpha`/`ang`/`scaled` 全进模型；`color` 等于第一个停靠点；单停靠点退化成纯色；零可用停靠点不产出 `fill`；`a:path` 仍不产出；非法 `pos` 的停靠点被丢弃
- **几何**：`ang=5400000` 得上下端点；`scaled=1` 且 `w=2h` 时 45° 得包围盒对角线；`scaled=0` 同角度得 45° 方向
- **场景**：停靠点颜色逐个解析（含主题色与 alpha）；纯色填充不产生渐变字段
- **绘制**：`createLinearGradient` 收到轴端点、`addColorStop` 收到 0..1 的偏移与每个停靠点颜色；带文本的形状同样
- **standalone 往返**：写出 `gradFill` 并能重新导入拿回同一个模型
- **写回（本切片的核心）**：①未编辑的渐变形状导出后**逐字节不变**；②只改文本时 `gradFill` 逐字保留（含 `rotWithShape`）；③把渐变改成纯色时 `gradFill` 被替换成 `solidFill`；④把纯色改成渐变时写出 `gradFill`
- **回归**：现有 1162 项测试

## 6. 已知限制

- `a:path` 径向/矩形/形状渐变不建模，指向它们的形状仍不填充（决策 3）
- `rotWithShape`、`a:tileRect`、`a:gs` 扩展在填充被编辑后丢失（决策 7）
- 主题 `fillStyleLst`/`bgFillStyleLst` 的渐变条目仍是 `null`（决策 6）
- 描边的渐变（`a:ln` 里的 `gradFill`）不建模 —— `stroke` 用同一个 `Fill` 类型，因此**类型上能表达**，但绘制端只用 `resolvedStrokeColor`，渐变描边会画成第一个停靠点的纯色
- 渐变没有 engine 命令与面板，只读
- `a:gs` 的 `pos` 不去重、不排序，畸形文件按原样送进 canvas
- **实施期间新发现**：元素自己的 `fill`/`stroke` **根本没进 `validateDocument`** —— 从来没有走过 `validateFill`。因此本切片新加的渐变校验只在幻灯片背景、表格单元格与主题条目那三条路径上生效，元素上的畸形渐变今天仍能通过校验。这是既有缺口、非本刀引入，也不在本刀范围（补它要给所有元素的填充与描边加校验，属独立切片）。

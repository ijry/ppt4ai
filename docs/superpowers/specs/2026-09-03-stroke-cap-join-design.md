# 描边端点与拐角设计

> 状态：已实现（2026-09-03，待填）
> 日期：2026-09-03

## 1. 目标

让 `a:ln/@cap` 与 `a:ln` 的拐角子元素（`a:round`/`a:bevel`/`a:miter`）进入模型并影响画布。宽度、线型、颜色、渐变都已打通，这两项是 `a:ln` 上最后两处能一对一映射到 canvas 的属性。

## 2. 探针结果（实测）

同宽同色四个形状，只有 `cap` 与拐角不同（无、`cap="rnd"`、`cap="sq"`+`a:bevel`、`a:round`）：

```
plain         : {…,"stroke":{…},"strokeWidth":76200}
cap=rnd       : {…,"stroke":{…},"strokeWidth":76200}
cap=sq+bevel  : {…,"stroke":{…},"strokeWidth":76200}
round join    : {…,"stroke":{…},"strokeWidth":76200}
```

**四个模型逐字相同** —— 两项都被丢掉。

**同时发现一处脆弱**：`grep lineCap|lineJoin` 全仓只命中 `table-painting.ts:107` 的 `context.lineCap = 'butt'`。形状绘制**从不设置**这两项，所以它们沿用画布上一次留下的值。今天恰好无害（canvas 默认就是 `butt`/`miter`，而表格设的也是 `butt`），但这与虚线那刀修掉的 `setLineDash` 泄漏是同一类问题 —— 一旦有代码设成 `round`，之后画的形状都会跟着圆。

## 3. 关键决策

**决策 1：模型用 OOXML 自己的词，导出即原样写出**

```ts
export type StrokeCap = 'flat' | 'rnd' | 'sq'
export type StrokeJoin = 'round' | 'bevel' | 'miter'
```

`cap` 的三个值就是 `ST_LineCap` 的三个词；拐角的三个值就是那三个子元素的名字。这与 `StrokeStyle` 用 `solid`/`dash`/`dot`（`prstDash` 的合法词）是同一条：**模型值能逐字写回文件**，导出端不需要一张映射表。

canvas 那侧才做映射（`flat`→`butt`、`rnd`→`round`、`sq`→`square`），因为那是绘制层的方言。**否决在模型里用 canvas 的词** —— 那会让导出端反向翻译，而模型的职责是记录文件说了什么。

**决策 2：`lineCap` 与 `lineJoin` 无条件设置**

与虚线那刀的 `setLineDash` 同一条理由：不设就会沿用画布上一次的值。无 `cap` 时设 `butt`、无拐角时设 `miter`，即 OOXML 与 canvas 共同的缺省。**顺带修掉第 2 节那处脆弱**，而不是只在有值时才设。

**决策 3：`a:miter/@lim` 不建模**

`lim` 是斜接长度上限，canvas 有对应的 `miterLimit`。但 OOXML 的 `lim` 是**百分比**而 canvas 的 `miterLimit` 是**倍数**，两者换算关系我无法从手头资料确认，猜一个会让厚轮廓的尖角在某些角度下明显错。**只建模拐角类型、不建模上限**，代价写进限制。

**决策 4：主题 `lnStyleLst` 条目的 cap/join 仍不建模**

`ThemeLineStyle` 目前只有 `color`/`width`/`style`。给它加 cap/join 需要同时加解析与逐属性回退，与主题线条样式那刀做过的事同构 —— 是独立一刀。本刀只做元素自己的两项，与描边宽度那刀当初只做元素、把主题留给后续同款。

**决策 5：写回在同一刀做完**

描边宽度那刀的教训：模型能持有一个导出端拒绝写出的值，就等于静默丢编辑。虽然本刀不加命令（模型值恒等于源值），仍然把写回一并做掉 —— `cap` 是属性、拐角是子元素，两者各自独立比较，与 `w`/`prstDash` 同款。

## 4. 契约（增量）

`StrokeCap`/`StrokeJoin` 新增到 `@ppt4ai/model`；`ShapeElement`/`TextElement` 新增 `strokeCap?`/`strokeJoin?`，进 `validateDocument`。

`SceneShapeNode`/`SceneTextNode` 透传两项。

`serializeShapeXml` 写 `cap` 属性与拐角子元素；`strokeReplacements` 各自独立比较与替换。

## 5. 测试策略

- **导入**：三个 `cap` 词各进模型；三个拐角元素各进模型；缺省时字段缺席；非法 `cap` 忽略
- **绘制**：`lineCap`/`lineJoin` 按映射设置；无值时设 `butt`/`miter`（钉住决策 2）
- **场景**：两项透传到两种节点
- **往返**：standalone 写出并能重新导入；改宽度时源 `cap` 与拐角逐字保留；改 cap 时写出新值；未编辑逐字节不变
- **回归**：现有 1395 项测试

## 6. 已知限制

- `a:miter/@lim` 不建模（决策 3），厚轮廓的尖角上限用 canvas 默认
- 主题 `lnStyleLst` 条目的 cap/join 仍不建模（决策 4）
- `a:cmpd`（复合线型：双线、粗细线）仍完全不建模 —— canvas 没有对应能力，需要自己画多条路径
- `a:algn`（描边相对路径居中/内侧）仍不建模，canvas 只能居中描边
- 两项都无命令与控件，只读

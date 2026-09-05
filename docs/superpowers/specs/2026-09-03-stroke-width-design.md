# 形状描边宽度设计

> 状态：已实现（2026-09-03，`3051297`）
> 日期：2026-09-03

## 1. 目标

让 `<a:ln w>` 进入模型并影响画布线宽。这是形状保真那一串切片（几何 → 样式矩阵 → 背景）剩下的最后一处明显偏差。

## 2. 探针结果（实测）

同一页放两个形状，轮廓同色但宽度差六倍（`w="12700"` = 1pt 与 `w="76200"` = 6pt）：

```
1pt: {"id":"el_1","kind":"shape","preset":"rect","bounds":{…},"stroke":{"color":{"type":"srgb","v":"203864"}}}
6pt: {"id":"el_2","kind":"shape","preset":"rect","bounds":{…},"stroke":{"color":{"type":"srgb","v":"203864"}}}
```

**两个模型逐字相同** —— `w` 被丢掉了。绘制端也从不设 `lineWidth`（grep `lineWidth` 在 `shape-painting.ts` 零命中），因此不论源文件写几磅，画布上都是一像素的发丝线。

## 3. 关键决策

**决策 1：加兄弟字段 `strokeWidth`，不把 `stroke` 改成对象**

```ts
export interface ShapeElement {
  stroke?: Fill          // 既有字段，语义不变
  strokeWidth?: number   // a:ln/@w，EMU
}
```

**否决了把 `stroke` 改成 `{ color, width? }`**：那要动每个既有消费者（导入、场景、两条导出路径、写回的 `fillsEqual` 比较、engine 的表格边框命令共用的类型）。而 `TableBorder` 早就是 `{ color, width?, style? }` —— 两种形状并存不理想，但改造是独立的收敛切片，不该混进本切片。

**决策 2：缺 `w` 时不发明默认宽度**

OOXML 里省略 `w` 意味着宽度来自样式/主题的 `lnStyleLst`，而**主题线宽本切片不建模**（样式矩阵切片只取了颜色）。因此模型无宽度时绘制保持今天的行为（不设 `lineWidth`，即一像素），**不猜一个 0.75pt 之类的值** —— 猜出来的粗细在整页上到处都错，比保持现状更难发现。

**决策 3：像素下限复用表格边框那条规则**

`table-painting.ts:78` 已有 `Math.max(1, width * mapping.scale)`：缩略图尺度下真实宽度会小于一像素，钳到 1 才看得见边。形状描边用同一条规则，注释指明出处。

**决策 4：写回不需要改，但要有断言**

`strokeReplacements` 只替换 `<a:ln>` 里的填充节点，从不碰 `w` 属性 —— 因此改描边颜色后宽度原样保留。这一点加断言钉住，因为它是「读进模型却不写回」能安全成立的唯一理由。

新建 `<a:ln>` 的分支（源里原本没有轮廓）仍写不带 `w` 的空元素：那种情况源里本来就没有宽度，模型也不会有。

## 4. 契约（增量）

`ShapeElement`/`TextElement` 新增 `strokeWidth?: number`（非负整数 EMU），进 `validateDocument`。

`SceneShapeNode`/`SceneTextNode` 新增 `strokeWidth?: number`。

## 5. 测试策略

- **导入**：`w` 进 `strokeWidth`；无 `w` 时字段缺席；非法值忽略而不产生字段
- **场景**：宽度透传到两种节点；无描边时不带宽度
- **绘制**：`lineWidth` 按 `width * scale` 设置；缩略图尺度下钳到 1；无宽度时不设 `lineWidth`
- **往返**：standalone 写出 `w` 并能重新导入；改描边颜色后源 `w` 逐字保留；未编辑逐字节不变
- **回归**：现有 1093 项测试

## 6. 已知限制

- 缺 `w` 时不推断主题线宽（决策 2），`lnStyleLst` 的 6350/12700/19050 仍不建模
- `cap`/`cmpd`/`algn`/`prstDash` 等线条属性仍不建模，虚线形状画成实线
- 占位符 `ElementDefaults` 不带宽度，因此从 layout/master 继承的描边只有颜色
- `stroke` 与 `TableBorder` 两套形状并存（决策 1）

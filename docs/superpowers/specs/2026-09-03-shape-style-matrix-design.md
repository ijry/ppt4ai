# 形状样式矩阵设计

> 状态：待实现（2026-09-03）
> 日期：2026-09-03

## 1. 目标

让只靠 `<p:style>` 引用主题 `fmtScheme` 上色的形状在画布上填充。这是上一切片（带文本的形状几何）点名的后继项 —— 形状已经会画填充了，本切片补上「颜色从哪来」的第二个来源。

## 2. 探针结果（实测）

一个 PowerPoint 默认样式的形状：`spPr` 里**没有** `solidFill`，颜色全靠 `<p:style>`；主题带完整 `fmtScheme`。

```
SHAPE: {"id":"el_1","kind":"text","bounds":{…},"text":"Styled","body":{…}}
THEME: {"id":"theme_1","colors":{…},"fonts":{…},"source":{…}}
```

**`<p:style>` 整块被丢，主题的 `fmtScheme` 也整块被丢**。形状既没有 `fill` 也没有 `stroke`，因此上一切片给它加的路径也无从生成 —— 画布上只有文字。用形状库（PowerPoint 的形状样式画廊）做的页面全是这个形状。

## 3. 关键决策

**决策 1：模型存引用，不存解析结果**

```ts
export interface StyleReference { idx: number; color?: Color }
export interface ShapeStyleReference {
  fill?: StyleReference
  line?: StyleReference
  effect?: StyleReference
  font?: { idx: 'major' | 'minor' | 'none'; color?: Color }
}
```

`ShapeElement` 与 `TextElement` 各新增 `styleRef?: ShapeStyleReference`。

**解析结果只进场景的 `resolvedFillColor`，绝不写进 `element.fill`** —— 写进模型会让写回把「跟随主题样式」改成一个钉死的 `<a:solidFill>`，语义完全变了，而且以后换主题这些形状不再联动。这与主题字体引用保留 `+mj-lt` 是同一条纪律。

**`effect` 与 `font` 只存不用**：渲染不消费它们，但 `CT_ShapeStyle` 要求四个 ref 齐全，存下来才能在 standalone 生成时写出合法的 `<p:style>`。

**决策 2：主题的 `fmtScheme` 只建模纯色条目，其余记为不支持**

```ts
export interface ThemeFormatScheme {
  fillStyles?: (Fill | null)[]   // 索引 = idx - 1；null = 我们表达不了的条目
  lineStyles?: (Fill | null)[]
}
```

Office 默认主题的 `fillStyleLst` 是 `[solidFill, gradFill, gradFill]` —— 而 `<a:fillRef idx="1">`（指向那个纯色条目）正是形状库里绝大多数形状用的。渐变/图案/图片填充我们的 `Fill` 只有 `{color}` 一种形态，表达不了，**记 `null` 而不是猜一个近似色** —— 猜出来的颜色比不填充更难发现是错的。

**决策 3：`phClr` 代入时保留两侧的 transform，顺序是「引用色的在前」**

主题条目写的是 `<a:solidFill><a:schemeClr val="phClr"><a:tint val="60000"/></a:schemeClr></a:solidFill>`，形状写的是 `<a:fillRef idx="1"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:fillRef>`。代入结果是 `accent1` 且 transform 为 `[shade 50%, tint 60%]` —— 引用色自己的变换先定下基色，条目的变换再修饰它。

**已核实 `resolveColorSource` 对 `phClr` 直接返回 undefined**（`color.v !== 'phClr'` 那个条件），所以没代入的 `phClr` 解析成「无颜色」而不是某个错颜色 —— 代入失败是可见的，不是静默错色。

**决策 4：直接填充优先于样式引用**

`spPr` 里的显式 `solidFill` 胜出，这是 OOXML 的直接格式优先规则。场景只在 `element.fill` 缺失时才去问样式引用。

**决策 5：standalone 只在四个 ref 齐全时才写 `<p:style>`**

`CT_ShapeStyle` 要求 lnRef/fillRef/effectRef/fontRef 全部存在。四个齐全（导入的 PowerPoint 形状必然如此）就原样写出；缺任何一个就整块省略，**不为凑合法性编造 ref** —— 编出来的 idx 会在阅读器里画出我们没预期的颜色。

源包写回不需要改：`<p:style>` 是 `spPr` 的兄弟节点，既有的范围写回只在 `spPr` 内部动手，因此未编辑的文件逐字节不变（加断言钉住）。

## 4. 契约（增量）

`@ppt4ai/model` 新增导出：`StyleReference`、`ShapeStyleReference`、`ThemeFormatScheme`、`resolveStyleFill`、`resolveStyleLine`。

`ShapeElement`/`TextElement` 新增 `styleRef?`；`Theme` 新增 `formatScheme?`。三者都进 `validateDocument`。

## 5. 测试策略

- **导入**：四个 ref 与各自的引用色进 `styleRef`；`fmtScheme` 的纯色条目进 `fillStyles`/`lineStyles`，渐变条目为 `null`；没有 `<p:style>` 时不产生 `styleRef`
- **解析**：`idx=1` 取第一条；`idx=0` 解析成无填充；指向 `null` 条目解析成无填充；`phClr` 代入保留两侧 transform 且顺序正确；主题缺 `fmtScheme` 时解析成无填充
- **场景**：只有 `styleRef` 的形状拿到 `resolvedFillColor` 与路径；显式 `fill` 胜过样式引用；文本元素同样生效
- **往返**：未编辑的源包逐字节不变；四个 ref 齐全时 standalone 写出 `<p:style>` 并能重新导入；缺 ref 时不写
- **回归**：现有 1056 项测试

## 6. 已知限制

- 渐变/图案/图片填充条目记 `null`，指向它们的形状不填充（决策 2）
- `lnStyleLst` 的线宽 `w` 不建模，样式来的轮廓只有颜色没有粗细
- `effectRef` 与 `fontRef` 只存不用：阴影、发光等效果仍不渲染，样式指定的字体色也不生效
- `bgFillStyleLst`（幻灯片背景样式）仍不读
- `a:custGeom` 与四种预设以外的几何仍不支持

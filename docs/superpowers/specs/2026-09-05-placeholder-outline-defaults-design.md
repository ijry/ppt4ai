# 占位符默认值的轮廓词汇

> 状态：已实现
> 日期：2026-09-05

## 1. 目标

让 master/layout 占位符的 `a:ln` 词汇与 `a:avLst` 进入 `ElementDefaults`，从而**继承的形状拿到真实的线宽、线型、端点、转角、复合、对齐与可调值**，而不是只拿到颜色。

## 2. 探针结果（实测）

探针已删除。layout 的 title 占位符写：

```xml
<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom>
<a:ln w="76200" cap="sq" cmpd="dbl" algn="in">
  <a:solidFill><a:srgbClr val="203864"/></a:solidFill>
  <a:prstDash val="lgDashDot"/><a:miter lim="800000"/>
</a:ln>
```

导入后该 layout 的 `defaults.title` 只有三个键：

```
["bounds", "preset", "stroke"]
```

`resolveInheritedElement` 因此把 `stroke`（藏青色）交给继承的形状，而**丢掉全部七项**：`strokeWidth`（6pt）、`strokeStyle`（`lgDashDot`）、`strokeCap`、`strokeCompound`、`strokeAlign`、`strokeMiterLimit`，以及 `adjustValues`（25% 圆角）。

一个 layout 定义的粗虚线边框，继承到页面上变成**细实线**。这与本会话修的几刀是同一个形状——**一侧读得出、另一侧读不出**——只是这次不对称在元素路径与默认值路径之间，而非导入与导出之间。

## 3. 关键决策

**决策 1：`ElementDefaults` 补齐元素侧已有的轮廓字段**

```ts
export interface ElementDefaults {
  …
  strokeWidth?: number
  strokeStyle?: StrokeStyle | { custom: DashSegment[] }
  strokeCap?: StrokeCap
  strokeJoin?: StrokeJoin
  strokeCompound?: StrokeCompound
  strokeAlign?: StrokeAlign
  strokeMiterLimit?: number
  adjustValues?: AdjustValue[]
}
```

字段名与 `ShapeElement` 逐字相同，**这是必需的而非风格选择**：`resolveInheritedElement` 用 `Object.assign({}, ...defaults, element)` 浅合并，同名才会覆盖。合并逻辑因此一行不改。

**决策 2：`shadow` 与 `customGeometry` 本刀不加**

同样的不对称对它们也成立，但各自带独立问题：`shadow` 要读 `a:effectLst`（占位符的效果列表还牵扯 `effectRef`），`customGeometry` 要判断 `a:custGeom` 与 `preset` 谁优先。两者都值得单独一刀，混进来会让本刀的验证面失焦。写进未实现。

**决策 3：导入端复用元素路径的解析器**

`parseDefaults` 已经调 `parseShapeFill`/`parseStroke`，再加七个既有函数（`parseStrokeWidth`、`parseDashStyle`、`parseStrokeCap`、`parseStrokeJoin`、`parseStrokeCompound`、`parseStrokeAlign`、`parseStrokeMiterLimit`）与 `parseAdjustValues`。**没有新解析器**——这正是这刀便宜的原因，也是它本该早就存在的证据。

`parseDashStyle` 的 `'solid'` 回退在这里同样要过滤（与元素路径逐字相同），否则每个占位符默认值都会带一个无意义的 `strokeStyle: 'solid'`。

**决策 4：导出端 `serializePlaceholderShapeXml` 写出它们**

它现在写 `<a:ln>${fill}</a:ln>`——只有填充。改为与 `serializeShapeXml` 同样的属性与子元素顺序（`w`/`cap`/`cmpd`/`algn` 属性，填充 → 虚线 → 转角），并把 `serializeGeometry` 的第二参数接上 `defaults.adjustValues`。

**决策 5：`a:ln` 只在有内容时写**

现在的条件是 `defaults.stroke ? … : ''`。一个只声明线宽而不声明颜色的占位符是合法的（颜色从 `lnRef` 或主题来），所以条件改为「任一轮廓字段存在」。否则新加的字段在没有颜色时写不出去。

## 4. 契约（增量）

`@ppt4ai/model`：`ElementDefaults` 新增八个可选字段；校验沿用元素侧的规则（`validateElementDefaults` 若已存在则扩展，否则不加——默认值目前不走 `validateDocument` 的元素分支）。

`@ppt4ai/pptx-import`：`parseDefaults` 增加八次调用。

`@ppt4ai/pptx-export`：`serializePlaceholderShapeXml` 写出八项；`a:ln` 的写出条件放宽。

`@ppt4ai/render`、`@ppt4ai/editor`：**不改**。`resolveInheritedElement` 的浅合并已经覆盖，场景层读的是合并后的元素。

## 5. 验证

`packages/pptx-import/src/placeholder-outline-defaults.test.ts`：
- layout 占位符的八项全部进 `defaults`
- `strokeStyle: 'solid'` 不进（与元素路径同规则）
- 继承的形状经 `resolveInheritedElement` 拿到八项
- 形状自己声明的值**覆盖**默认值（浅合并的方向）

`packages/pptx-export/src/placeholder-outline-defaults.test.ts`：
- standalone 写出的 layout 部件含完整 `a:ln` 与 `a:avLst`
- 往返：八项逐字回来
- 只有线宽没有颜色时 `a:ln` 仍写出

## 6. 已知限制

**`shadow` 与 `customGeometry` 仍不进默认值**——**已在 `156bc84` 补上**（连 `styleRef` 一起）。决策 2 给的搁置理由经复盘只有一半成立：`customGeometry` 的优先级早已定好，`shadow` 那半的正确动作是把 `styleRef` 一并加上而非延后。见 [2026-09-05-placeholder-effect-defaults-design.md](./2026-09-05-placeholder-effect-defaults-design.md)。

**默认值不参与 `validateDocument` 的元素校验**——**已在后续一刀修掉**。这条当时的措辞也不够准确：默认值其实**部分**走校验（`rotation` 与 `listStyle` 一直在查），缺的是其余字段。现在元素侧与默认值侧共用同一个 `validateStrokeVocabulary`，加上 `fill`/`stroke`/`shadow`/`customGeometry`/`styleRef` 各自的既有校验器。

## 7. 实现记录（2026-09-05）

实现提交 `43c790f`。按设计执行，两处值得记：

**探针本身踩了一个既有行为**：第一版探针给 slide 的占位符写 `<p:spPr/>`（完全不声明位置，靠继承拿 bounds），结果**元素根本没进模型**——`parseElement` 在 `bounds` 缺失时返回 `undefined`，文本分支也一样。这不是本刀的缺口，但值得记下来：**「占位符不写 xfrm、位置全靠继承」这种真实存在的写法目前导入不了**。要修得让 `parseElement` 接受无 bounds 的占位符并在解析继承后补齐，那是独立一刀（会牵动导出的索引对齐）。探针改为给形状自己的 bounds 后才跑通。

**`a:ln` 的写出条件必须放宽**，否则新加的七个字段在没有描边颜色时全写不出去——一个占位符只声明线宽、颜色从 `lnRef` 来是合法写法。条件从 `defaults.stroke ?` 改成「任一轮廓字段存在」，并加了一条测试钉住「有宽度无颜色也写」。

两份测试的区分力都验证过：把 `parseDefaults` 的八次调用整段删掉，10 条里 5 条立刻标红（导入 4 条 + 导出的往返 1 条）。

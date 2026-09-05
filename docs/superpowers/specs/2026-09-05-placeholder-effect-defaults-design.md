# 占位符默认值的阴影、自定义几何与样式引用

> 状态：已实现
> 日期：2026-09-05

## 1. 目标

让 master/layout 占位符的 `a:effectLst/a:outerShdw`、`a:custGeom` 与 `<p:style>` 进入 `ElementDefaults`。这是上一刀（`43c790f`）刻意留下的三项。

## 2. 探针结果（实测）

探针已删除。layout 的 title 占位符同时声明这三样：

```xml
<a:custGeom>…<a:pathLst>…</a:pathLst></a:custGeom>
<a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000">…</a:outerShdw></a:effectLst>
…
<p:style><a:lnRef idx="2">…</a:lnRef><a:fillRef idx="1">…</a:fillRef>
  <a:effectRef idx="0">…</a:effectRef><a:fontRef idx="minor">…</a:fontRef></p:style>
```

导入后该 layout 的 `defaults.title` 只有：

```
["bounds", "preset"]
```

三项全丢。继承的形状因此拿不到阴影、拿不到那条自定义路径、也拿不到主题样式引用——**一个 layout 定义的带阴影的自定义形状，继承到页面上是个无阴影的矩形**。

**顺带发现**：`defaults.preset` 是 `"rect"`，因为 `parsePreset` 在没有 `a:prstGeom` 时回退到 `rect`。声明了 `a:custGeom` 的占位符于是留下一个误导性的 `preset`。建模 `customGeometry` 后这条自然被盖住（绘制优先用它），因此本刀不动那个回退。

## 3. 上一刀的搁置理由，两条里有一条不成立

上一刀写：「`shadow` 要读 `a:effectLst`（占位符的效果列表还牵扯 `effectRef`），`customGeometry` 要判断 `a:custGeom` 与 `preset` 谁优先」。

**`customGeometry` 那条不成立**：优先级早已定义——`model/index.ts` 的注释写着 `customGeometry` 存在时「replaces `preset` for drawing」，绘制层照此执行。没有新问题要解决。

**`shadow` 那条部分成立**：`effectRef` 确实是另一条路，但它属于 `styleRef`，而 `styleRef` 本身也不在默认值里——所以正确的做法不是搁置 `shadow`，而是**把 `styleRef` 一并加上**。两者一起加，直接声明的效果与引用的效果就都在了。

## 4. 关键决策

**决策 1：三个字段，三个既有解析器**

`parseOuterShadow`、`parseCustomGeometry`、`parseShapeStyleReference` 都已存在且已被元素路径调用。与上一刀一样，本刀不新增解析器。

**决策 2：`<p:style>` 是 `p:sp` 的子元素，不在 `p:spPr` 里**

导出端 `serializeShapeStyleXml(defaults.styleRef)` 要放在 `p:spPr` 之后、`p:txBody` 之前，与 `serializeShapeXml` 逐字相同的位置。

**决策 3：自定义几何取代预设几何，与元素路径同规则**

`serializePlaceholderShapeXml` 的几何分支改为 `defaults.customGeometry ? serializeCustomGeometry(...) : serializeGeometry(...)`，与 `serializeShapeXml` 第 632 行同形。

## 5. 契约（增量）

`@ppt4ai/model`：`ElementDefaults` 新增 `shadow?: OuterShadow`、`customGeometry?: CustomGeometry`、`styleRef?: ShapeStyleReference`。

`@ppt4ai/pptx-import`：`parseDefaults` 增加三次调用。

`@ppt4ai/pptx-export`：`serializePlaceholderShapeXml` 写出三项。

`@ppt4ai/render`、`@ppt4ai/editor`：**不改**（浅合并已覆盖）。

## 6. 验证

`packages/pptx-import/src/placeholder-effect-defaults.test.ts`：三项各自进默认值；继承的形状拿到三项；形状自己声明的覆盖默认值；`a:custGeom` 存在时 `preset` 仍是 `rect` 但绘制用路径（钉住既有回退）。

`packages/pptx-export/src/placeholder-effect-defaults.test.ts`：standalone 写出 `a:effectLst`、`a:custGeom`、`<p:style>`；往返三项回来；`<p:style>` 位置在 `p:spPr` 之后。

## 7. 已知限制

**`ElementDefaults` 仍不参与 `validateDocument`**：与上一刀相同的既有状况。

## 8. 实现记录（2026-09-05）

实现提交 `待填`。按设计执行，无偏离。三个字段各一次既有解析器调用、各一处导出写出；`resolveInheritedElement` 的浅合并一行未改。

区分力已验证：删掉 `parseDefaults` 里那三次调用，12 条里 5 条标红。

**上一刀的搁置理由值得复盘**。它写「`customGeometry` 要判断与 `preset` 谁优先」，而那个优先级早在模型注释里定好、绘制层也照此执行——搁置的理由是我没去查，不是问题真的存在。另一半（`shadow` 牵扯 `effectRef`）方向对，但结论错：正确的动作不是搁置 `shadow`，而是把 `styleRef` 一并加上，因为 `effectRef` 就住在 `styleRef` 里。**「这项有独立问题所以延后」这种理由，本身要先验证再采信。**

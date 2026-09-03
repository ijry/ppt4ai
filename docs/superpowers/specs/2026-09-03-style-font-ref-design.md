# 样式矩阵字体引用设计

> 状态：已实现（2026-09-03，`468c0cc`）
> 日期：2026-09-03

## 1. 目标

让 `<p:style><a:fontRef>` 的颜色与字体槽位真正影响文字绘制。这是样式矩阵四个引用里最后一个「只存不用」的（`effectRef` 是另一个，但效果整体不渲染，是更大的独立缺口）。

## 2. 探针结果（实测）

用形状库那种形状：`spPr` 全空，颜色全靠 `<p:style>`，文字颜色只由 `fontRef` 提供：

```
<a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef>
<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef>
```

导入结果：

```
element : {…,"styleRef":{"fill":{"idx":1,…},"line":{…},"effect":{…},"font":{"idx":"minor","color":{"type":"scheme","v":"lt1"}}}}
```

**模型里 `font` 引用是完整的** —— `idx` 与 `phClr` 代表色都在（样式矩阵那刀存下来是为了 standalone 能写出合法 `<p:style>`）。

**但场景图从不读它**：`grep styleRef` 在 `scenegraph.ts` 只命中 `fill` 与 `line`，`font` 零命中。run 上没有 `marks.color`，所以 `resolvedColor` 是 `undefined`，而绘制端 `colorState(undefined)` 返回 **`#000000`**（`text-painting.ts:39`）。

后果很直接：**形状库里那些「深色底 + 白字」的形状，白字全画成黑字**。`accent1`（`4472C4` 深蓝）底上的黑字几乎读不出来。这不是细微偏差，是可读性问题。

## 3. 关键决策

**决策 1：`fontRef` 的颜色是「run 颜色的默认值」，优先级最低**

层级从高到低：run 自己的 `marks.color` → 分级默认（`defRPr`/`lstStyle`/`txStyles`）→ **`fontRef` 颜色** → 绘制端的黑色兜底。

`fontRef` 排在分级默认之下，因为它是**形状级**的样式矩阵默认，而分级默认是**文本级**的显式声明。一个写了 `<a:defRPr><a:solidFill>` 的占位符应当胜过形状的 `fontRef`。

**否决「把 fontRef 颜色写进模型的 run marks」** —— 那与样式矩阵那刀「模型只存引用、解析只进场景」是同一条纪律：写进模型会让写回把「跟随主题样式」钉死成一个 `<a:solidFill>`，以后换主题不再联动。

**决策 2：解析放在 `toSceneTextLayout` 的 run 循环里，而不是预先塞进 body**

`resolvedFontFamily`/`resolvedColor` 已经在那个循环里逐 run 计算。把 `fontRef` 解析结果作为该循环的**兜底参数**传进去，就与既有两项走同一条路，不需要在 `mergeLevelDefaults` 之前额外造一层合并。

**决策 3：`fontRef/@idx` 的 `major`/`minor` 映射到主题字体，`none` 不给字体**

`idx` 是 `ST_FontCollectionIndex`（`major`/`minor`/`none`）。`major` → `+mj-lt` 家族、`minor` → `+mn-lt`。这与 `resolveThemeFontFamily` 已经在做的 `+mj-lt` 解析是同一张表，复用它而不是另写一套。

**`none` 与缺失都不产出字体** —— 不猜。

**决策 4：`fontRef` 字体同样是最低优先级**

run 的 `marks.fontFamily`（含 `+mj-lt` 这类引用）胜过 `fontRef/@idx`。理由与颜色相同：run 上的声明是显式的，`fontRef` 是形状级默认。

**决策 5：只影响场景与绘制，导入导出写回一行不改**

`styleRef.font` 早就完整进模型、早就能写出 `<p:style>`。本刀只是让场景开始消费它。写回不涉及（`<p:style>` 是 `spPr` 的兄弟，范围写回只在 `spPr` 内动手 —— 样式矩阵那刀已有断言）。

## 4. 契约（增量）

`resolveStyleFontColor(reference, theme, colorMap)` 与 `resolveStyleFontFamily(reference, theme)` 新增到 `@ppt4ai/model`。

`SceneTextLayoutRun.resolvedColor`/`resolvedFontFamily` 语义不变，只是多了一个来源。

## 5. 测试策略

- **解析**：`fontRef` 的 `phClr` 代入引用色；`idx="major"`/`"minor"` 各解析到对应主题字体；`idx="none"` 与无 `fontRef` 不产出
- **场景**：只有 `fontRef` 的形状，run 拿到白色与 `Calibri`；run 自己的 `marks.color` 胜过 `fontRef`；分级默认的颜色也胜过 `fontRef`；run 的 `fontFamily` 胜过 `fontRef/@idx`
- **端到端**：深色底 + `fontRef lt1` 的形状，绘制端 `fillStyle` 是 `#FFFFFF` 而不是 `#000000`（这条正是探针里那个可读性缺陷）
- **回归**：现有 1253 项测试

## 6. 已知限制

- `fontRef` 只给 latin 槽位的字体；中日韩/复杂文字仍走 run 自己的 `fontFamilyEa`/`fontFamilyCs` 与主题解析
- `effectRef` 仍只存不用（效果整体不渲染，是独立缺口）
- `fontRef` 没有编辑入口，只读
- 表格单元格的文字不走 `styleRef`（表格有自己的 `TableStyleText`），本刀不涉及
- **实现期修正的一处测试断言**：`resolvedFontFamily` 只在「与 `marks.fontFamily` 不同」时才写入场景（既有设计，见 `resolvedFontFamily` 注释）。所以「run 自己写了 `Georgia`」这一条，正确的契约是**场景不写 `resolvedFontFamily`、绘制端退回 `marks.fontFamily`**，而不是场景写入 `'Georgia'`。第一版测试按后者断言、红了；改成断言前者。实现本身没有改动。

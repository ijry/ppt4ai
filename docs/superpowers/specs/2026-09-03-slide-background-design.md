# 幻灯片背景设计

> 状态：待实现（2026-09-03）
> 日期：2026-09-03

## 1. 目标

让幻灯片的背景色进入模型并画在画布与缩略图上。这是页级缺口：有背景色的 PPT 导入后每一页都是白底。

## 2. 探针结果（实测）

一页自带深蓝背景（`<p:bgPr><a:solidFill><a:srgbClr val="1F3864"/>`），其母版背景走主题引用（`<p:bgRef idx="1001"><a:schemeClr val="lt1"/>`），主题带 `bgFillStyleLst`。

```
SLIDE:  {"id":"sld_1","elementIds":["el_1"],"layoutId":"lyt_1","masterId":"mst_1","source":{…}}
MASTER: {"id":"mst_1","defaults":{},"themeId":"theme_1","colorMap":{…},"source":{…}}
THEME:  {"id":"theme_1","colors":{"lt1":{…}},"source":{…}}
```

**三处一处都没读**：幻灯片自己的 `1F3864` 没了，母版的 `bgRef` 没了，主题的 `bgFillStyleLst` 也没进 `formatScheme`。模型里**根本没有背景字段** —— grep `background`/`bg` 在 `packages/model` 与导入器里都是零命中。

后果是页级的：**任何有背景色的 PPT 导入后都是白底**。深色版式的 deck 尤其明显 —— 文字仍按原色画，于是浅色文字落在白底上几乎看不见。

## 3. 关键决策

**决策 1：背景挂在 slide/layout/master 三处，按就近可用继承**

```ts
export interface SlideBackground {
  fill?: Fill                 // p:bgPr 的直接填充
  styleRef?: StyleReference   // p:bgRef 指向主题 bgFillStyleLst
}
```

`Slide`、`SlideLayout`、`SlideMaster` 各新增 `background?: SlideBackground`。解析时按 **slide → layout → master** 取第一个存在的整体使用，**不做逐字段合并** —— OOXML 的 `p:bg` 是整体覆盖，一页要么自己定义背景要么完全继承。这与占位符 `body` 的整体覆盖同款。

**决策 2：`bgRef` 的 `idx` 原样存文件里的值，减 1000 发生在解析期**

`ST_BackgroundStyleIndex` 里 `1001` 表示 `bgFillStyleLst` 的第一条，而 `fillRef` 的 `1` 表示 `fillStyleLst` 第一条 —— 两套基数不同。**模型存 1001 而不是归一化成 1**：归一化会让 standalone 写不回原值，而模型的既定纪律是「存作者写下的东西」。换算放在解析函数里，并在注释写明基数差异。

**决策 3：场景图只带解析后的颜色**

`SceneGraph` 新增 `background?: ResolvedColor`。渐变/图案/图片背景条目仍记 `null`（沿用样式矩阵切片的处理），因此这类背景解析成「无颜色」、画布落回默认底 —— 与形状指向渐变条目时不填充一致。

**决策 4：两条绘制路径各加一次全页填充**

画布渲染器与缩略图 worker 各自在画节点之前填一次页面矩形，坐标用与形状绘制完全相同的 `mapping`（`(0,0)` 到 `(page.w * scale, page.h * scale)`），因此不引入第二套坐标假设。

**决策 5：写回不动，standalone 补 `<p:bg>`**

`p:bg` 是 `p:cSld` 的子元素、在 `p:spTree` 之前，既有范围写回只在 `p:sp` 与已知部件内动手，因此未编辑的文件逐字节不变（加断言钉住）。standalone 在幻灯片有背景时写出 `<p:bg>`。

## 4. 契约（增量）

`@ppt4ai/model` 新增导出：`SlideBackground`、`resolveSlideBackground`。

`Slide`/`SlideLayout`/`SlideMaster` 新增 `background?`；`ThemeFormatScheme` 新增 `backgroundStyles?`。都进 `validateDocument`。

`SceneGraph` 新增 `background?: ResolvedColor`。

## 5. 测试策略

- **导入**：`p:bgPr` 的直接填充、`p:bgRef` 的 idx 与引用色分别进三处；`bgFillStyleLst` 进 `formatScheme.backgroundStyles`；无 `p:bg` 时不产生字段
- **解析**：幻灯片自己的背景胜过 layout 与 master；缺失时逐级回退；`bgRef idx=1001` 取第一条并代入 `phClr`；`idx=0` 与指向 `null` 条目都解析成无颜色
- **场景**：`background` 出现在图上且 clone-safe；没有任何背景时字段缺席
- **绘制**：画布与缩略图都先填一次页面矩形；无背景时不产生填充调用
- **往返**：未编辑逐字节不变；standalone 写出的 `<p:bg>` 能重新导入
- **回归**：现有 1076 项测试

## 6. 已知限制

- 渐变/图案/图片背景不支持（条目记 `null`），落回画布默认底
- `<p:bg>` 里的 `<a:effectLst>` 等未建模内容在 standalone 生成时不写出
- 没有命令能改背景（无 engine 命令、无面板），只读
- `p:bgRef` 在 layout 上还能引用 master 的背景样式覆写链，本切片只做三级就近取用

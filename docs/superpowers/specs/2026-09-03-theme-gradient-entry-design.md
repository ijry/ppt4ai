# 主题渐变条目设计

> 状态：待实现（2026-09-03）
> 日期：2026-09-03

## 1. 目标

让主题 `fillStyleLst`/`bgFillStyleLst` 里的渐变条目不再记 `null`，使只靠 `p:style/a:fillRef` 或 `p:bgRef` 取填充的形状与幻灯片拿到真实渐变。上一刀（线性渐变填充）在「已知限制」里点名了这处，并已把 `Fill` 准备好。

## 2. 探针结果（实测）

主题 `fillStyleLst` 用 Office 原装形态（条目 1 纯色、条目 2 是 `phClr` 两停靠点渐变），`bgFillStyleLst` 同构；页上一个形状 `spPr` 全空只有 `<a:fillRef idx="2">`，幻灯片背景是 `<p:bgRef idx="1002">`：

```
fillStyles: [{"color":{"type":"scheme","v":"phClr"}},null]
bgStyles  : [{"color":{"type":"scheme","v":"phClr"}},null]
element   : {"id":"el_1","kind":"shape",…,"styleRef":{"fill":{"idx":2,…}}}
background: {"styleRef":{"idx":1002,"color":{"type":"scheme","v":"accent1"}}}
```

**两个列表的渐变条目都是 `null`** —— 形状指向条目 2、背景指向条目 1002，两者都解析不出任何东西，于是形状不填充、幻灯片没有背景。而 `Fill` 从上一刀起已经能表达线性渐变，所以这个 `null` 现在纯属没接上。

## 3. 关键决策

**决策 1：解析用同一个「填充节点」函数，导入端不再有两套规则**

主题条目**本身就是填充节点**（`<a:solidFill>` / `<a:gradFill>` 直接挂在列表下），而形状的填充是**包在 `spPr` 里的**。今天两处各写一遍「找 solidFill」。抽出 `parseFillNode(节点)` 收一个填充节点，`parseDirectFill(拥有者)` 找到子节点后转交它，`parseThemeStyleEntries` 直接映射列表子节点。

这样「渐变怎么读」只有一处 —— 否则主题这条路径会漏掉 `a:path` 不建模、停靠点 ≥2、顺序不排序等每一条已定规则。

**决策 2：新增 `resolveStyleFillGradient`，与 `resolveStyleLineStroke` 同构**

`resolveStyleFill` 继续只返回 `ResolvedColor`。新函数返回 `ResolvedGradient`，**逐停靠点做 `phClr` 替换再解析** —— 这是本切片真正的技术核心：Office 主题的渐变停靠点几乎全是 `phClr` 带一串变换，替换规则（引用色作底、条目变换追加在引用变换之后）必须逐停靠点复用，不能只对条目的 `color` 做一次。

**否决改 `resolveStyleFill` 的返回类型**：与主题线条样式那刀同样的理由 —— 颜色与另一项解析路径不同，且改签名要动每个调用点。

**决策 3：场景对渐变逐属性回退，与描边同一条规则**

```ts
const fillGradient = resolvedFillGradient(element.fill, context) ?? resolveStyleFillGradient(element.styleRef?.fill, …)
```

直接 `spPr` 里的渐变胜出；没有直接填充时取主题条目。这与 `shapeStroke` 的 `直接 ?? 主题` 一致。

**决策 4：背景本刀只升级到「画平」，真正的渐变背景是下一刀**

条目一旦不再是 `null`，`resolveSlideBackground` 读 `entry.color` 就能拿到**第一个停靠点**，于是背景从「什么都不画」升级为「画平」—— 这是上一刀「`color` 承载第一个停靠点」那条决策自动带来的收益，不需要额外代码。

**真正画出渐变背景本刀不做**，理由是实测发现的一处独立问题：`slide-canvas-renderer.ts` 的页面坐标空间自相矛盾 —— 它把变换设成 EMU→设备像素（`setTransform(dpr·EMU_TO_CSS_PIXEL·zoom, …)`），却把已经换算成 CSS 像素的内容画进去（`fillRect(0,0, page.w·scale, page.h·scale)`，绘制层同样收 `scale = EMU_TO_CSS_PIXEL·zoom`）。实测 1280×720 的画布上，背景矩形与一个满页形状都落在 1280×720，而在那个变换下它们只覆盖约 0.13 像素。**在没弄清这个空间之前，不能在里面算渐变轴** —— 轴算错会被当成渐变实现的 bug，而根因在别处。详见第 6 节。

**决策 5：导出端零改动，但要有断言**

`serializeFillXml` 从上一刀起就会在 `fill.gradient` 存在时写 `gradFill`，而 standalone 的 `themeStyleFillXml` 调的正是它 —— 所以主题渐变条目的写出**本刀不需要新代码**。主题写回从不触碰 `fmtScheme`，源里的列表原样保留。两条都加断言，因为「不需要改」是结论而不是假设。

## 4. 契约（增量）

`resolveStyleFillGradient(reference, theme, colorMap)` 新增导出。

`SceneShapeNode`/`SceneTextNode` 的 `resolvedFillGradient` 不变形状，只是多了一个来源。

导入端新增内部 `parseFillNode`，`parseThemeStyleEntries` 改为经它解析（行为上从「只认 solidFill」变成「solidFill 或线性 gradFill」）。

## 5. 测试策略

- **导入**：Office 原装 `fillStyleLst` 的渐变条目进模型（停靠点、`ang`、`scaled` 全在）；`a:path` 条目仍是 `null`；单停靠点条目退化成纯色条目；`bgFillStyleLst` 同样
- **解析**：`phClr` 逐停靠点替换（引用色作底、变换顺序为引用在前条目在后）；引用不带颜色时该停靠点解析不出、不足两个则无渐变；`idx=0`/越界/`null` 条目返回 `undefined`
- **场景**：只有 `fillRef` 的形状拿到主题渐变；元素自己的渐变胜出；带文本的形状同样
- **背景**：渐变背景条目现在解析成第一个停靠点的纯色（决策 4）
- **导出**：standalone 写出主题渐变条目并能重新导入；改主题颜色后源 `fmtScheme` 的渐变逐字保留
- **回归**：现有 1214 项测试，尤其断言过 `lineStyles`/`fillStyles` 具体值的地方

## 6. 已知限制

- **`slide-canvas-renderer.ts` 的页面坐标空间自相矛盾（实测，非本刀引入）**：变换是 EMU→设备像素，内容却是 CSS 像素。今天没被发现的原因也已查明 —— `apps/` 下**没有任何东西**通过 `createSlideCanvasRenderer` 渲染（只有 `packages/editor/src/SlideCanvas.vue` 用它，而没有 app 挂载它），单测只断言 `setTransform` 的参数、从不检查内容是否落在画布内。**未在真实浏览器里验证**，因此只作为「疑似缺陷」记录，不在本刀修。渐变背景要等它定论。
- `a:path` 径向条目仍是 `null`（与上一刀同一条决策）
- 图案/图片填充条目仍是 `null`
- `satMod` 等不在 `ColorTransformType` 里的变换在停靠点上被丢弃（既有颜色模型限制，Office 原装渐变条目就带 `satMod`）
- 主题渐变条目只读，没有编辑入口

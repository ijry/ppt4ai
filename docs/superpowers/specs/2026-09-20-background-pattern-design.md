# 背景图案填充设计

> 状态：已实现（2026-09-20）
> 日期：2026-09-20

## 1. 目标

把图案填充（`a:pattFill`）那套已建好的解析与绘制管道，最后一段接到幻灯片背景上。形状填充早已能解析并画出图案（`resolvedFillPattern` + `paintPatternFill`），渐变背景也已打通（`backgroundGradient`），但幻灯片/版式/母版的 `p:bg` 若声明的是图案填充，场景里没有任何字段承载它，画布只填第一个（平色后备）。这一刀补上 `backgroundPattern`。

## 2. 当前状态（实测）

`resolveSlideBackground` 只读 `fill.color`，因此图案背景被解析成平色的前景色，`documentToSceneGraph` 也从不产出图案字段。形状节点同款图案却能正常画出。

## 3. 关键决策

**决策 1：模型加 `resolveSlideBackgroundPattern`，与 `resolveSlideBackground` 同构**

新导出函数沿「幻灯片 → 版式 → 母版取第一个声明背景的那层」的同一条链，返回 `ResolvedPattern | undefined`：

- 若那层是直接 `fill`：`fill.gradient` 存在则返回 undefined（渐变胜过同时存在的图案，与形状同规则），否则解析 `fill.pattern`。
- 若那层是 `styleRef`（`idx >= 1001`）：按 `idx - 1000` 取 `formatScheme.backgroundStyles` 条目，条目带渐变则返回 undefined，否则解析条目的 `pattern`，`phClr` 由引用自带的颜色替换。

复用既有的内部 `resolveStylePattern` 与 `styleEntryAt`，不引入第二套颜色/索引判定。

**否决「让 `resolveSlideBackground` 一次返回 color+gradient+pattern」** —— 那要改所有读 `scene.background.rgb` 的绘制点。渐变背景当初就是单开一个 `backgroundGradient` 字段，图案照办。

**决策 2：场景加 `backgroundPattern?: ResolvedPattern`**

`documentToSceneGraph` 调 `resolveSlideBackgroundPattern`，存在时才挂到场景上（与 `backgroundGradient`/`backgroundPicture` 同款条件展开），保持 structured-clone 安全。

**决策 3：两条绘制路径共用形状的 `paintPatternFill`，把整页当作路径**

`slide-canvas-renderer.ts` 与 `thumbnail-worker.ts` 各自把页面框 `{0,0,page.w,page.h}` 拼成矩形路径，交给 `paintPatternFill`。图案自己画背景色再画前景（线条或百分比覆盖），因此**替换**平色/渐变分支而非叠加。`paintPatternFill` 返回 false（预设无几何、无覆盖）时回退到既有的渐变/平色填充，与形状节点「无几何图案退回平前景」一致。

## 4. 测试策略（TDD，逐层红→绿）

- **模型**（`background-pattern.test.ts`，5 项）：直接图案解析双色；`styleRef` 经偏移索引 + `phClr` 解析；最近 `p:bg` 整块胜出、不沿链合并；有效填充是渐变时返回 undefined（直接与 `bgRef` 两路）；未解析色/缺引用/非法索引返回 undefined。
- **场景**（`render/background-pattern.test.ts`，6 项）：直接图案产出 `backgroundPattern` 与平色后备；纯色不产出；渐变胜出不产出；无背景不产出；structured-clone 安全；母版 `styleRef` 经主题 + `phClr` 解析。
- **绘制**（`editor/pattern-background.test.ts`，2 项 + `thumbnail-worker.test.ts` 追加 2 项）：图案裁剪到整页并画出两种颜色、平色 `fillRect` 不再执行；无图案时只画平色。
- **回归**：全量 2358 项。

## 5. 已知限制

- 图案背景没有 engine 命令与面板，只读（与平色/渐变背景一样，背景编辑整体未做）。
- 母版/版式的图片背景仍写不出（与本刀无关，见继承图片背景那刀的限制）。
- 图案背景经无源写回后是否逐字节可逆未在本刀验证（本刀只覆盖读取→解析→绘制三层，写回走既有的 `a:pattFill` 补丁器）。

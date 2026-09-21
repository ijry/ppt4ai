# 渐变背景设计

> 状态：已实现（2026-09-03，`ec9792b`）
> 日期：2026-09-03

## 1. 目标

让线性渐变填充那刀已经建好的渐变管道，最后一段也接到幻灯片背景上。当前 `SlideBackground` 已有 `fill: Fill`（`b75f4e6`），`resolveSlideBackground` 已会把渐变的第一个停靠点解析成 `ResolvedColor`（因为 `resolvedFillColor` 只读 `fill.color`），但**完全不看 `fill.gradient`** —— 所以渐变背景被画成平色。

## 2. 当前状态（实测）

探针：母版 `<p:bgPr>` 带两停靠点线性渐变（`4472C4` → `203864`，`ang="5400000"`），slide 继承它：

```
background         : {"rgb":"4472C4","alpha":100000}
backgroundGradient : undefined
```

场景里根本没有 `backgroundGradient` 字段，画布上填的是 `#4472C4` 纯色矩形。而形状节点同样的渐变已经能画出真实的渐变（`b75f4e6` 那刀）。

## 3. 关键决策

**决策 1：场景加 `backgroundGradient?: ResolvedGradient`，复用形状节点那套解析**

`resolveSlideBackground` 的返回类型从 `ResolvedColor | undefined` 改成 `{ color, gradient? }`，与 `SceneShapeNode`/`SceneTextNode` 的 `resolvedFillColor` + `resolvedFillGradient` 同构。`color` 仍是第一个停靠点（作为平色后备），`gradient` 存在时才画渐变。

**否决「让 `resolveSlideBackground` 直接返回 `ResolvedGradient | ResolvedColor`」** —— 那要改绘制端所有读 `scene.background.rgb` 的地方，而「`color` 是第一个停靠点、`gradient` 存在时优先」已经是形状与文本节点的既定模式，背景照办不引入第二套判定。

**决策 2：`resolvedFillGradient` 提到 `scenegraph.ts` 顶层成为共享辅助函数**

它原本写在文件里间、只被 `toSceneShapeNode`/`toSceneTextNode` 调用，现在 `resolveSlideBackground` 也需要它。提到顶层后三处共用同一条「停靠点 < 2 就没有渐变」的规则。

**决策 3：渐变轴在绘制期计算，用与节点完全相同的映射后坐标**

`slide-canvas-renderer.ts` 里背景矩形已经是 `fillRect(0, 0, page.w · scale, page.h · scale)`，与形状/文本节点的 `mapping(bounds)` 在同一个 CSS 像素空间。把 `{ x:0, y:0, w:page.w, h:page.h }` 传给 `gradientAxis`，拿到的端点就是这个空间里的坐标，`createLinearGradient` 直接用。

`thumbnail-worker.ts` 同理：它的 `mapping` 是恒等（目标像素），背景矩形 `fillRect(0, 0, targetWidth, targetHeight)`，渐变轴算出来也在目标像素空间。

**否决「在场景里预先算好轴端点」** —— 那需要知道目标尺寸与 `scale`，而场景构建期不知道画布会以什么尺寸渲染。把轴计算放在绘制期，与形状节点「场景只存 `gradient`、绘制时才算轴」一致。

**决策 4：两条绘制路径各加一个 `if (gradient)` 分支，否则走既有的 `fillStyle = toRgba(background)`**

`slide-canvas-renderer.ts` 与 `thumbnail-worker.ts` 各自在 `clearRect` 与填充之间插入：若 `backgroundGradient` 存在，`fillStyle` 设成 `createLinearGradient` 的结果；否则用 `background` 平色。形状节点已经是这个模式（`paintPathFills` 里 `fill.gradient` 存在就设渐变、否则设 `resolvedFillColor`），背景照办。

## 4. 测试策略

- **场景**：带渐变背景的 slide 产出 `background` 与 `backgroundGradient`；纯色背景不产出 `backgroundGradient`；渐变停靠点 < 2 时退化成平色（只有 `background`）
- **绘制**：`slide-canvas-renderer` 与 `thumbnail-worker` 都对渐变背景调 `createLinearGradient` 并传入正确的轴端点与停靠点；平色背景不调 `createLinearGradient`
- **端到端**：一个带渐变背景的文档，`documentToSceneGraph` → 画到 `RecordingContext`，断言 `fillStyle` 被赋值为 `CanvasGradient`（`RecordingContext` 要加 `createLinearGradient` 桩）
- **回归**：既有 1242 项测试

## 5. 已知限制

- 渐变背景没有 engine 命令与面板，只读（与平色背景一样，背景编辑整体未做）
- `a:path` 径向渐变背景仍解析成「无背景」（与形状填充同款限制）
- 渐变背景的 `rotWithShape`/`tileRect` 等属性在被编辑后丢失（与形状填充同款限制）
- **`resolveSlideBackground` 的签名一行未改**：实现时发现不需要动它 —— 场景直接取 `slide/layout/master` 三级里第一个 `background.fill`，`gradient` 就在那个 `Fill` 上。改签名会牵动所有调用点，而取字段不会。设计文档决策 1 原本写「返回类型改成 `{ color, gradient? }`」，实际实现比它更小。
- **过程中一次误操作已回滚**：写测试时用 `Write` 覆盖了既有的 `slide-canvas-renderer.test.ts`（含 4 项测试），已 `git checkout` 还原并确认坐标空间那刀的 `toBe(2)` 断言完好，新测试改放 `gradient-background.test.ts`。教训是新增测试要用新文件名，不要与既有测试文件同名。

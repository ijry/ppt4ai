# 图案纹理绘制（`a:pattFill` 第二刀）

> 状态：待实现
> 日期：2026-09-05

## 1. 目标

让 `a:pattFill` 在画布上画出**纹理**而不是前景纯色。数据层已由 `8fe9e56` 打通（`preset` 逐字保存、两色解析、两条导出路径写出），`PAINTED_PRESET_PATTERNS` 就是当时给这一刀留的落点。

今天 `pct5` 与 `pct90` 视觉相同、背景色只存不画——两个都写在上一刀的已知限制里。

## 2. 上一刀的一条理由需要更正

图案填充那刀写的延期理由是「三条绘制路径里 `thumbnail-worker.ts` 在 worker 里没有 canvas API，得走 `OffscreenCanvas`」。**读代码后这条不成立**：三条路径都汇聚到 `shape-painting.ts` 的 `paintShapeNode`（`slide-canvas-renderer.ts:57`、`thumbnail-worker.ts:251` 都调它），所以画法只需写一处，worker 自动跟着走。

仍然成立的是另一半：`createPattern` 需要一张离屏光栅 tile，而测试里的假 context（`picture-fill-rendering.test.ts:136` 的 `FakeContext`）**没有 `createPattern`**，选它就得改测试骨架。

## 3. 关键决策

**决策 1：几何画法，不用 `createPattern`**

不生成 tile，而是「裁剪到形状路径 → 铺背景色 → 用前景色描一组线」。

代价与收益：

| | `createPattern` + tile | 几何线条 |
|---|---|---|
| 离屏 canvas | 需要 | 不需要 |
| 三条路径 | 共用 `paintShapeNode`，都一样 | 同上 |
| 测试 | 假 context 要加 `createPattern`，断言只能看到「传了个 canvas」 | 假 context 已有 `clip`/`stroke`，线条位置可在 geometry 层纯函数测 |
| 密集图案性能 | 一张 tile 重复 | 线条数随形状尺寸增长 |

选几何画法，因为**可测**且不碰环境差异。密集图案的操作数写进已知限制。

**决策 2：只画名字能确定的东西——方向与相对密度**

54 个预设在 Office 里是 8×8 位图，逐像素布局无法在此核实。但两件事**写在词里**：

- **方向**：`Horz` 水平、`Vert` 垂直、`UpDiag`/`DnDiag` 两个斜向、`Cross` 双向、`DiagCross` 双斜向
- **相对密度**：`lt`（light）比基础词细、`dk`（dark）比基础词粗；`nar` 间距更密、`wd` 更疏；`sm` 网格比 `lg` 密

因此本刀实现**线条族**共 16 个词，方向按名字取，粗细与间距按 tier 取一组常量。

**磁量本身是近似，写进限制并列入阅读器核对清单**——与 `dashPattern` 把十一个虚线词收敛成四种结构完全同一个交易：ECMA-376 的确切长度此处无法核实，所以不发明精确值，只保证名字声明的区分在画布上看得见。

**决策 3：百分比族与装饰族本刀不画**

`pct5`…`pct90`（12 个）是点阵，密度确实写在名字里，但一个满页形状在高缩放下要画上万个点——性能问题独立于本刀，单列。

`zigZag`/`weave`/`sphere`/`shingle`/`plaid`/`divot`/`trellis`/`horzBrick` 等装饰词的形状**不在名字里**，猜不出来，继续画前景纯色。

`PAINTED_PRESET_PATTERNS` 只列本刀真画的 16 个词，其余走既有的前景纯色回退——这个常量的意义就是让「画不画」可查、可测。

**决策 4：几何算在 `@ppt4ai/geometry`，画在 `@ppt4ai/editor`**

沿用仓库既有分工（`createPresetPath`、`gradientAxis`、`gradientFocus` 都在 geometry）：

```ts
// @ppt4ai/geometry
export interface PatternGeometry {
  lines: Array<{ from: GeometryPoint; to: GeometryPoint }>
  lineWidth: number
}
export function patternGeometry(preset: string, bounds: GeometryBounds): PatternGeometry | undefined
```

纯函数、无 canvas，线条位置直接单测。返回 `undefined` 表示「这个词本刀不画」，绘制层据此回退到前景纯色。

**决策 5：背景色终于画出来**

`a:bgClr` 上一刀只存不画。几何画法天然要先铺背景（否则线条之间是透明的），因此本刀顺带把它画上——`pct5` 与 `pct90` 之所以今天相同，一半原因就是两者的背景都没画。

## 4. 契约（增量）

`@ppt4ai/geometry`：新增 `PatternGeometry` 接口与 `patternGeometry(preset, bounds)`。

`@ppt4ai/model`：`PAINTED_PRESET_PATTERNS` 从空数组变成 16 个词。

`@ppt4ai/editor`：`shape-painting.ts` 新增 `paintPatternFill(context, pattern, bounds, path)`；`paintShapeNode` 的填充分支在 `resolvedFillPattern` 存在且 `patternGeometry` 返回非空时调它，否则保持现有的前景纯色 `fill()`。`paintTextNode` 同步（带填充的文本元素走同一条路）。

绘制顺序：`clip(path)` → 背景色 `fillRect(bounds)` → 前景色描线。裁剪放在 `save()`/`restore()` 之间，与 `paintPictureFill` 的做法一致。

## 5. 验证

`packages/geometry/src/pattern-geometry.test.ts`：

- `ltHorz` 在 100×100 盒里给出一组水平线，`y` 递增、`x` 跨满盒宽
- `ltVert` 给出垂直线
- `dkHorz` 与 `ltHorz` 方向相同、`lineWidth` 更大
- `narHorz` 比 `horz` 线更多（间距更密）
- `ltUpDiag` 的线斜率为负（左下到右上），`ltDnDiag` 为正
- `cross` 的线数等于同尺寸 `horz` 加 `vert`
- `diagCross` 同理覆盖两个斜向
- 未实现的词（`zigZag`、`pct50`）返回 `undefined`
- 零宽或零高的盒子返回 `undefined`（没有可画的区域）
- `PAINTED_PRESET_PATTERNS` 里每个词都能拿到非空几何（常量与实现不许漂移）

`packages/editor/src/pattern-painting.test.ts`：

- 有图案的形状记录 `clip` → `fill`（背景）→ `stroke`（线条）
- 背景色与前景色分别落在 `fillStyle`/`strokeStyle` 上
- 未实现的词只记录一次 `fill`，不 `stroke`（前景纯色回退）
- 无图案的形状行为逐字不变

## 6. 已知限制

**磁量未经阅读器核对**：线宽与间距是本刀选的常量，与 Office 的 8×8 位图不会逐像素相同。名字声明的区分（方向、相对密度）画得出来，绝对尺寸画不准。列入 `2026-09-05-阅读器核对清单.md`。

**百分比族（12 个）与装饰族（26 个）仍画前景纯色**：前者是性能问题（满页形状上万个点），后者是形状猜不出来。

**密集图案的操作数随形状尺寸增长**：一个满页 `narHorz` 在高缩放下是几百条线。tile 化是独立优化，等有实测慢再做。

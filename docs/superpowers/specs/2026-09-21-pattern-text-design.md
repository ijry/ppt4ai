# 图案文字绘制设计

> 状态：已实现（2026-09-21）
> 日期：2026-09-21

## 1. 目标

让 run 级**图案填充**的文字在画布上体现图案密度,而不是一律画平前景色。run 图案填充已能导入/往返(`087cad5`),但绘制只用前景平色。

## 2. 关键决策

**决策 1：场景加 `SceneTextLayoutRun.resolvedFillPattern`,复用形状那套 `resolvedFillPattern`**

run 映射调 `resolvedFillPattern(run.marks?.color, context)`,两色经主题解析;任一色解析不出则退化平色(与形状同规则)。

**决策 2：绘制复用形状描边那套「百分比合成色」,而非逐字裁剪纹理**

文字字形太小,把网点纹理裁进字形既不现实也无收益。复用 `shape-painting` 里已导出的 `percentagePatternStroke`(把 `pctNN` 前景/背景按覆盖率合成为一个平滑色),用作字形的 `fillStyle`——与百分比图案描边、百分比图案填充的取舍一致(平均色在任意缩放下匹配)。线条族预设(`ltHorz` 等,`patternCoverage` 返回 undefined)保留平前景。放在渐变分支之前,渐变仍可覆盖(手工模型两者都写时,渐变胜,与形状精度一致)。

**决策 3：横排与竖排(直立+旋转)统一走 `paintHorizontalItem`?**

否——图案合成色只在 `paintHorizontalItem` 处理(横排 run)。竖排字形按 run 走的是 `paintVerticalItem`,本刀不改(竖排图案文字仍平前景,单列)。

## 3. 测试策略（TDD）

- **绘制**（`editor/text-run-pattern-painting.test.ts`,2 项）：`pct50` run 画出非前景的合成色且不建渐变；`ltHorz` 线条族保留平前景。
- **回归**：全量 2431 项。

## 4. 已知限制

- 只有百分比族(`pctNN`)体现密度;线条/装饰族仍平前景(与形状图案填充同规则)。
- 竖排图案文字仍平前景(横排已支持;竖排是独立小切片)。
- 不画真实网点纹理,用平均合成色代替(性能取舍,全项目一致)。

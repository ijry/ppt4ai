# 动画播放器内核设计（状态机 + 绘制变换）

> 状态：已实现（纯函数，2026-09-22）
> 日期：2026-09-22

## 1. 目标

把 [播放引擎内核](2026-09-22-animation-playback-core-design.md) 与 [时序编排](2026-09-22-animation-timeline-orchestration-design.md) 接到渲染的可测部分：一个**纯**的播放状态机（当前步/步内耗时/是否播放）与一个**纯**的绘制变换换算（`ElementOverride` → 具体 bounds 上的 opacity/位移/缩放/旋转）。空壳的 `@ppt4ai/player`（已声明 model/render/animate 依赖）是落地点。rAF 驱动与 editor 绘制层的 override 包裹是后续刀——它们是仅有的非 headless 部分。

## 2. 关键决策

**决策 1：`overridePaintTransform(bounds, override)` 纯换算**

`ElementOverride` 是「元素框的分数 / 绕中心倍数 / 度数」，绘制层需要的是具体数值。此函数把它换成 `{ opacity, translateX, translateY, scale, rotationDeg }`：位移 = 比例 × 自身宽/高（单位随 bounds，EMU）；无 override 时返回恒等，调用方可无条件套用。绘制层再把 EMU→px，并把它叠在元素自身 transform 之外（据 render 调研，editor 的 `withFlipAndRotation` 已是「绕框中心 translate→rotate→scale」的现成范式）。

**决策 2：播放状态机全是纯函数转移**

`PlaybackState = { steps, stepIndex, elapsedMs, playing }`，可序列化。`createPlayback` 用 `planTimeline` 切步；`overridesFor` = `timelineOverridesAt`。转移：`tick(state, Δ)` 播放中推进步内耗时、夹到步长即停（停在完成态等下一次点击）；`advance`（点击）三态——未播的步起点则开播、播放中则一键跳到完成态、已完成则进下一步开播；`seekStep`/`reset`/`play`/`pause`。`stepIndex === steps.length` 表示全部结束（幻灯片终态）。rAF 只负责给 `tick` 喂 wall-clock Δ，是唯一天然非纯的一层。

## 3. 测试策略（TDD）

- **overridePaintTransform**（2 项）：按 bounds 换算数值（位移 = 比例×宽/高）；无 override 恒等。
- **状态机**（7 项，linear 缓动取确定值）：首帧入场隐藏、不播放；首次 advance 开播并按时插值；耗时夹到步长即停；步完成后 advance 进下一步（前步停在原位、后步待入场）；播放中 advance 一键跳完成态；连点越过末步落到终态；pause 后 tick 不推进。
- **回归**：player 全量通过。改上游 animate 后已先 build 再跑下游（下游吃 dist）。

## 4. 后续（本刀不含）

- rAF 驱动：一个循环持有 wall-clock，每帧 `tick` 并把 `overridesFor` 的 map 交给渲染器（唯一非 headless 部分）。
- editor 绘制集成：给 `render()` 加 `overrides?` 参数，在 `drawNode`/图片分支外层用 `overridePaintTransform` 的结果做 `save → globalAlpha*=opacity → 绕中心 translate/scale/rotate → restore` 包裹（可用 editor 的 RecordingContext 无 canvas 测）。
- presetID→稳定 preset 名映射（权威数值表待获取，勿凭记忆猜）。

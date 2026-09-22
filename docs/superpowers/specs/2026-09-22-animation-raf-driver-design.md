# 动画 rAF 驱动设计

> 状态：已实现（2026-09-22）
> 日期：2026-09-22

## 1. 目标

动画特性的收尾：把 [播放器内核](2026-09-22-animation-player-core-design.md) 的纯状态机接到 wall-clock，逐帧算出 override 并交给 [绘制集成](2026-09-22-animation-paint-integration-design.md) 的 `render()`。这是全链路唯一天然非 headless 的一层。

## 2. 关键决策

**决策 1：`paintOverridesFor` 把 override 解析成绘制变换（纯）**

给定 `PlaybackState` 与「node id → bounds」，对 `overridesFor(state)` 的每个 override 调 `overridePaintTransform(bounds, …)`，产出 `Map<id, OverridePaintTransform>` 交给 `render({ overrides })`。bounds 未知的元素跳过。纯函数、可测。

**决策 2：驱动的时钟与帧调度可注入**

`createSlidePlayer({ timeline, boundsById, onFrame, now?, scheduleFrame?, cancelFrame? })`：默认用 `performance.now`/`requestAnimationFrame`/`cancelAnimationFrame`，测试注入假时钟与手动帧队列。每帧 `state = tick(state, time - lastTime)`，`onFrame(paintOverridesFor(...))`，仍在播放则续帧。所有状态转移都来自 `./playback` 的纯函数，故驱动本身也能无真 rAF 地测。

**决策 3：交互——play/pause/next/reset/dispose**

`play` 起播当前步并记 `lastTime=now()`；`pause` 停止推进并取消挂起帧；`next`（点击）走状态机 `advance` 并立即 emit；`reset` 回到首步之前；创建时先 emit 一次初始静止态（入场隐藏）；`dispose` 取消挂起帧。

## 3. 测试策略（TDD）

- **player.test.ts**（5 项，注入假时钟 + 手动帧队列）：创建即 emit 初始隐藏态；播放中逐帧插值（250ms→opacity 0.5）；步完成后不再续帧且元素归静止（无 override）；pause 取消挂起帧；next 起播当前步并立即 emit 步起点态。
- **回归**：player 全量 14 项（含 playback 9 项）。

## 4. 全链路完成

至此动画特性打通：模型 → 播放内核 → 时序编排 → 强调预设 → 交互触发 → 导入 `p:timing` → 写回 `p:timing` → 播放状态机 + 绘制变换 → editor 绘制叠加 → rAF 驱动。剩余为保真增强，且多卡在未验证数据（presetID→名映射、repeatCount 单位）或更高保真行为（emphasis 行为节点、motion path），非本链路必需。

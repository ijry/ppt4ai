# 动画时序编排设计

> 状态：已实现（纯函数，2026-09-22）
> 日期：2026-09-22

## 1. 目标

接续 [动画播放引擎内核](2026-09-22-animation-playback-core-design.md) §4 的第一条后续：把 `mainSeq` 的多个 build 编排成可 seek 的「点击步进」时间线。内核只算「一个 build 在自身时刻的 override」；本刀在其上算「整段主序列在第 N 步、步内 t 毫秒时的 override」。仍是纯函数、可 headless 单测、不碰文档模型。

## 2. 关键决策

**决策 1：按 `onClick` 切步，步内相对时序**

`planTimeline` 把 `mainSeq` 切成若干 `TimelineStep`。首个 build 与每个 `trigger === 'onClick'` 的 build 各开一步；`withPrev` 与上一 build 同起点，`afterPrev` 在上一 build 结束时起。每个 build 记 `startMs`（相对步起点），build 内 item 保留各自的 `delay`。结果是给播放器的一组可 seek 步骤，每步带 `durationMs`（步内最晚的 build 结束）。

**决策 2：build 时长取 item 最晚结束**

`buildDuration` = `max(delay + duration)`。`afterPrev` 的起点、以及步的 `durationMs`，都用它——含单个 item 的 `delay`，所以带前摇的 item 也能正确撑开时长。

**决策 3：过往步按「结束态」贴，当前步按 `timeMs` 贴**

`timelineOverridesAt(steps, stepIndex, timeMs)`：`stepIndex` 之前的每一步都在其 `durationMs`（结束）处求值——已入场的元素停在原位、已退场的停在隐藏；当前步在 `timeMs` 处求值。合成顺序为步序→build 序→item 序的 last-write。`stepIndex` 越界向 `[0, steps.length]` 收敛：`-1` 得首步之前的静止态（entrance 隐藏），`steps.length` 得全部步结束后的终态。

## 3. 测试策略（TDD）

- **planTimeline**（3 项）：首 build 与每个 onClick 各开一步；`withPrev`/`afterPrev` 在同一步内的 `startMs`；build 时长取 item 最晚结束（含 `delay`），据此定 `afterPrev` 起点与步时长。
- **timelineOverridesAt**（4 项）：首步之前 entrance 隐藏；已入场元素在下一步起点停在满不透明、待入场元素隐藏；步内插值；seek 过末步后每步贴结束态（已退场隐藏、已入场无 override）。
- **回归**：全量测试通过。

## 4. 后续（本刀不含）

- `interactiveSeq` 触发（点击对象/媒体触发的建立组）——本刀只编排 `mainSeq`。
- rAF 驱动 + 把 override 喂给 `paint()`（渲染集成）。
- 导入/导出 `p:timing` ↔ `animations`。
- emphasis（脉冲/放大/颜色）与 motion path。

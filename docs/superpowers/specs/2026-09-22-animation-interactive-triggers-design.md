# 动画交互触发（interactiveSeq）设计

> 状态：已实现（模型字段 + 纯函数，2026-09-22）
> 日期：2026-09-22

## 1. 目标

补齐 [动画时序编排](2026-09-22-animation-timeline-orchestration-design.md) §4 的第一条后续：`interactiveSeq`（点击对象触发）。此前 `SlideTimeline.interactiveSeq` 已能校验，但「哪个形状触发该 build」无处安放——模型缺字段。本刀补齐模型字段与校验，并给播放器一个「点击某形状→该触发哪些 build」的纯函数。

## 2. 关键决策

**决策 1：`AnimationBuild` 增加 `triggerId?`**

新增可选 `triggerId`（元素 id）：interactiveSeq build 记录触发它的形状；mainSeq build 省略。放在 build 而非 timeline 上，因为一个形状可触发多个 build、不同形状各自独立。

**决策 2：校验 `triggerId` 指向存在的元素**

`validateAnimationBuild`：`triggerId` 存在时必须是字符串且引用现有元素（与 `item.targetId` 同规则）。对任意 build 生效——不强制「仅 interactiveSeq 才有」，保持校验简单；语义由文档约定（省略于 mainSeq）。

**决策 3：交互序列不进点击步进，各自从零播放**

与 mainSeq 不同，交互 build 不是点击步进的一部分。`interactiveBuildsFor(timeline, triggerId)` 按文档顺序返回该形状触发的所有 interactiveSeq build；播放器点击时对每个用既有 `buildOverridesAt` 从 0 起跑。纯过滤，无新时序模型。

## 3. 测试策略（TDD）

- **模型**（`animation.test.ts`，+2 项）：`triggerId` 引用现有元素通过；引用缺失元素报 `triggerId must reference an element`。
- **animate**（`playback.test.ts`，+3 项）：按文档顺序返回某形状触发的全部 build；无匹配返回空；绝不返回 mainSeq build。
- **回归**：model 全量 209 项、animate 全量通过。跨包：改了 `@ppt4ai/model` 后先 build 再跑 animate（下游吃 dist）。

## 4. 后续（本刀不含）

- rAF 驱动 + 把 override 喂给 `paint()`（渲染集成），含交互 build 的点击派发。
- 导入/导出 `p:timing` ↔ `animations`（含 `interactiveSeq` 的 `triggerId` 往返）。
- motion path、`AnimationItem` 的路径数据建模。

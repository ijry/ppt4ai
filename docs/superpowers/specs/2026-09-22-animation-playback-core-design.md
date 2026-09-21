# 动画播放引擎内核设计

> 状态：已实现（纯函数内核，2026-09-22）
> 日期：2026-09-22

## 1. 目标

§10 动画第二刀:播放引擎的纯函数内核。给定一个 build(触发组)与当前时刻,算出每个元素的 override(opacity/offset/scale)。可 headless 单测,不依赖 canvas,不碰导入导出——正是架构 §5.2 说的"SceneGraph 之上的一层 override,不污染文档模型"的计算部分。

## 2. 关键决策

**决策 1：override 用比例而非绝对像素**

`ElementOverride` 的 `offsetXRatio`/`offsetYRatio` 是元素自身宽/高的分数(1=一个整宽),`opacity` 0..1,`scale` 绕中心的倍数。绘制层按元素 bounds 缩放它们——内核不需要知道页面尺寸或缩放,保持纯粹可测。

**决策 2：每个 item 在 `[delay, delay+duration]` 上跑,区间外持"静止态"**

entrance 起始前静止=隐藏(opacity 0)、结束后无 override(元素归自然态);exit 反之(起始前无 override、结束后隐藏)。同一元素多个 item 按作者顺序 last-write 合成。zero-duration 视作瞬时,起点无 override。

**决策 3：预设映射先覆盖常见几种,未知预设回落 fade**

`fade/appear/fly(flyIn/flyOut)/zoom/disappear` 已实现方向(8 向 `direction`)与缓动(`linear/easeIn/easeOut/easeInOut`,默认 easeOut);未知预设回落 fade——阅读器对未实现效果该退化为淡入而非硬弹入。emphasis 与 motion path 暂返回空 override(后续刀)。

## 3. 测试策略（TDD）

- **内核**（`playback.test.ts`,7 项）:entrance 起始前隐藏、按时长淡入、结束后无 override;fly 方向偏移随缓动归零;exit 起始前无 override→淡出→结束隐藏;同元素后写胜;zero-duration;缓动端点。
- **回归**:全量 2517 项。

## 4. 后续（本刀不含）

- 多 build 的时序编排(onClick 步进、withPrev/afterPrev 相对时序、interactiveSeq 触发)。
- rAF 驱动 + 把 override 喂给 `paint()`(渲染集成)。
- 导入/导出 `p:timing` ↔ `animations`。
- emphasis(脉冲/放大/颜色)与 motion path。

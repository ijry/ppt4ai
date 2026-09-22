# 动画 playground 可跑 demo 设计

> 状态：已实现（2026-09-22）
> 日期：2026-09-22

## 1. 目标

把动画全链路接成一个**能跑、能肉眼看**的 demo：playground 里一张幻灯片 + 三形状 + 三步点击时间线，用 `createSlidePlayer` 逐帧把 override 喂给 `SlideCanvas`（[组件接入](2026-09-22-animation-slide-canvas-prop-design.md)）。访问 `#animation` 即进入 demo。

## 2. 关键决策

**决策 1：可测的宿主 + 薄 Vue 粘合**

`animation-demo-host.ts`（纯逻辑，可测）：建 demo 文档 → `documentToSceneGraph` → scene、`boundsById`、`createPlayer(onFrame, timing?)`（timing 可注入假时钟供测试）。`AnimationDemo.vue` 只做粘合：`shallowRef` 存 overrides，播放器 `onFrame` 换引用触发 `SlideCanvas` 重绘，播放/下一步/重置三个按钮。`main.ts` 按 `location.hash === '#animation'` 选挂 demo 还是编辑器，改动最小、不动现有编辑器 App。

**决策 2：三步 onClick，演示点击步进 + 三类效果**

淡入（entrance fade）→ 从左飞入（entrance fly）→ 旋转强调（emphasis spin），各自 onClick 成独立步，`下一步` 逐步触发。

**决策 3（借 demo 发现并修复的正确性问题）：未到达步的入场元素要预隐藏**

搭 demo 时发现 `timelineOverridesAt` 只处理「≤当前步」的步，**未来步里的入场元素不会被隐藏**——它们会在自己那步之前就满不透明地显示，与真实演示不符。修复：在合成时先把「当前步之后各步的 entrance 目标」置 `{opacity:0}`（最低优先级，过去/当前步覆盖它）。这是 [时序编排](2026-09-22-animation-timeline-orchestration-design.md) 的正确性补丁，配了 animate 单测（step 0 时 step 1 的入场元素为隐藏）。

## 3. 测试策略（TDD）

- **animate**（+1 项）：未到达步的入场元素在当前步被预隐藏。
- **animation-demo-host.test.ts**（3 项）：scene 节点与时间线目标一致且都有 bounds；初始帧隐藏首步入场 + 待触发入场（emphasis 元素静止无 override）；注入假时钟点击后首步插值。
- **回归**：animate 25、player 14、editor 557、playground 全量 120，均通过；playground `vite build` 通过（demo 可生产打包）。改上游包后已 `pnpm install` + 重建 animate/player/editor 的 dist（下游吃 dist）。

## 4. 全链路收尾

至此动画从 pptx 文件到屏幕、从模型到逐帧点击播放，端到端可跑可见。剩余仅为卡在未验证数据的保真项（presetID→名映射、repeatCount 单位）与 motion path 建模。

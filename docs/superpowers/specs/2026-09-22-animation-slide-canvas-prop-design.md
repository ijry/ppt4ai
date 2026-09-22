# 动画 override 接入 SlideCanvas 组件设计

> 状态：已实现（2026-09-22）
> 日期：2026-09-22

## 1. 目标

把 [绘制集成](2026-09-22-animation-paint-integration-design.md) 的 `render({ overrides })` 暴露到实时组件 `SlideCanvas.vue`，让 app（或 [rAF 驱动](2026-09-22-animation-raf-driver-design.md) 的 `createSlidePlayer`）能逐帧把动画 override 喂进真实渲染路径。这是把已完成的动画链路接到活的编辑器视图的一步。

## 2. 关键决策

**决策 1：新增可选 `overrides` prop，透传进 render viewport**

`SlideCanvas.vue` 加 `overrides?: ReadonlyMap<string, NodePaintOverride>`，在 `draw()` 里 `...(props.overrides ? { overrides } : {})` 并入 `render(...)` 的 viewport。无 prop 时行为与之前逐字一致。

**决策 2：`overrides` 进 watch 依赖，新 map 触发重绘**

把 `props.overrides` 加进重绘 watch。播放器每帧产出**新的 map 引用**（`paintOverridesFor` 返回新 Map），引用变化即触发一次 `draw()`——播放器不需要知道组件内部，只管换 prop。

## 3. 测试策略（TDD）

- **slide-canvas-overrides.test.ts**（2 项，happy-dom 挂载 + 录制型 canvas mock）：带 `overrides {opacity:0.5}` 挂载 → 渲染后录到该节点 fill 的 globalAlpha 为 0.5；无 overrides → fill 不透明（1）。
- **回归**：editor 全量 557 项、无回归。

## 4. 后续（本刀不含）

- playground demo 页：`createSlidePlayer` 驱动 `overrides` prop，肉眼跑一遍 onClick 步进 + 各预设。
- presetID→稳定 preset 名映射（权威数值表待获取，勿猜）。

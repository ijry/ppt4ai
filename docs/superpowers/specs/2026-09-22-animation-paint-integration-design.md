# 动画绘制集成（override → editor 绘制层）设计

> 状态：已实现（2026-09-22）
> 日期：2026-09-22

## 1. 目标

把 [播放器内核](2026-09-22-animation-player-core-design.md) 算出的每元素 override 真正画出来：给 editor 的 `render()` 加 `overrides`，在绘制每个节点时叠加透明度/位移/缩放/旋转，**不改动 SceneGraph**（架构 §5.2）。无 override 时逐字保持原绘制行为。

## 2. 关键决策

**决策 1：透明度走 `mapping` 的 base-alpha（穿透 painter）**

各 painter 是 `context.globalAlpha = X`（绝对赋值），wrapper 层设的 alpha 会被覆盖。故在三个 `*PageMapping`（Shape/Text/Table）上加可选 `alpha`，`drawNode` 把 override 的 opacity 放进去，painter 每处 `globalAlpha = X` 改成 `X * (mapping.alpha ?? 1)`（shape/text/table 共约 20 处，含渐变/图案/高亮/描边/表格边）。渐变本用 `globalAlpha = 1`（alpha 在 stop 上），乘以 base 后整体一起变淡，符合预期。

**决策 2：几何走节点外层的 canvas 变换 wrapper**

位移/缩放/旋转无法靠改 `bounds` 实现（几何已烘进 `path`/`layout` 的绝对坐标），故 `withNodeOverride` 在节点自身 rotation/flip 之外套一层：`save → globalAlpha*=opacity → translate(位移) → 绕框中心 translate/rotate/scale → draw → restore`。位移的 override 单位是 EMU，乘 `scale` 换成 px；旋转是**普通度数**（顺时针），直接 `deg*π/180`——注意别用 `rotationRadians`（那是 EMU 1/60000° 单位）。

**决策 3：图片透明度靠 wrapper 的 `globalAlpha`**

`paintImageNode` 用 `globalAlpha *=`（相乘）应用图片自身效果，故 wrapper 先 `globalAlpha *= opacity` 再画，图片会正确合成——图片不走 `mapping`，与 shape/text/table 两套机制但都正确。

**决策 4：override 类型不引入 editor→player 依赖**

editor 定义结构等价的 `NodePaintOverride`（字段全可选），player 的 `OverridePaintTransform`（字段全必填）可直接赋值传入，无需 editor 依赖 player/animate。

## 3. 测试策略（TDD）

- **base-alpha**（`override-painting.test.ts`，2 项）：`paintShapeNode` 带 `mapping.alpha` 时 fill 的 globalAlpha 被乘上；不给 alpha 时保持不透明。
- **render wrapper**（3 项，走真实 `render()` + RecordingContext）：按 override opacity 变淡；几何 override 发出 `scale`/`rotate` 变换；节点无对应 override 时逐字不变。
- **回归**：editor 全量 555 项、无回归（约 20 个 alpha 站点改动）。render dist 为当前。

## 4. 后续（本刀不含）

- rAF 驱动：循环持 wall-clock，每帧 `tick` 播放状态、`overridesFor` → `overridePaintTransform` 建 map 交给 `render()`。这是唯一天然非 headless 的一层。
- presetID→稳定 preset 名映射（权威数值表待获取，勿猜）。
- emphasis 的 `p:animEffect`/`p:animRot` 等更高保真行为、motion path。

# 动画强调（emphasis）预设设计

> 状态：已实现（纯函数，2026-09-22）
> 日期：2026-09-22

## 1. 目标

接续 [动画播放引擎内核](2026-09-22-animation-playback-core-design.md) §4 后续：把先前占位返回空 override 的 emphasis（强调）类做成真正的预设映射。仍是内核的纯函数——给定 item 与 eased 进度，算出 `ElementOverride`；不碰文档模型、不依赖 canvas。

## 2. 关键决策

**决策 1：emphasis 两端归 identity，与静止态无缝合成**

强调效果在 `p=0` 与 `p=1` 都回到元素自然态，所以区间外的 `restingOverride` 对 emphasis 返回 `undefined`（既不隐藏也不偏移）时能干净衔接。「往返型」效果（grow/pulse/teeter）用 `wave = sin(π·eased)`（两端 0、中点 1）；spin 用单调爬升到整圈。

**决策 2：为 spin/teeter 增加 `rotation`（度，绕中心顺时针）**

`ElementOverride` 新增 `rotation?`（度数，绕元素框中心顺时针）。与既有 `offset*/scale` 一样，是「算得出、绘制层后续消费」的字段——渲染集成仍是后续刀。

**决策 3：未知 emphasis 回落 identity，而非 fade**

entrance/exit 的未知预设回落 fade（退化为淡入/淡出是合理的）；但对 emphasis，淡暗一个本该被「强调」的元素是错的，故未知 emphasis 停在 identity（返回空 override）。

已实现预设与默认参数：

| preset | 效果 | 参数（params，字符串存储） |
| --- | --- | --- |
| `spin` / `spinner` | 旋转爬升到整圈 | `degrees`（默认 360） |
| `teeter` | 绕正立小幅摆动，两端归零 | `degrees`（默认 8） |
| `grow` / `growShrink` / `grow/shrink` | 缩放往返到峰值 | `amount`（默认 1.5） |
| `pulse` | 不透明度下探再回升 | `amount`（下探深度 0..1，默认 1） |

缓动沿用 item 的 `params.easing`（默认 easeOut）；测试用 `linear` 取确定端点。

## 3. 测试策略（TDD）

- **emphasis**（`playback.test.ts`，7 项）：spin 中点 180°、结束后无 override；teeter 峰值 8°、中点归零；grow 中点峰值缩放、结束归 identity；自定义 `amount`；pulse 不透明度往返；未知 emphasis 停在 identity；emphasis 静止态不隐藏元素。
- **回归**：animate 全量通过。

## 4. 后续（本刀不含）

- motion path（需在模型里表达路径数据；`AnimationItem.params` 目前只是字符串键值）。
- `interactiveSeq` 触发——需先给 `AnimationBuild` 增加「触发它的形状」字段（模型改动），故不在本刀。
- rAF 驱动 + 把 `rotation`/`scale`/`offset` 喂给 `paint()`（渲染集成）。
- 导入/导出 `p:timing` ↔ `animations`。

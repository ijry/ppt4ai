# 动画 presetID → 名映射（尽力而为）设计

> 状态：已实现（尽力而为，2026-09-22）
> 日期：2026-09-22

## 1. 目标

导入时把 OOXML 的数字 `presetID` 译成播放内核认识的稳定 preset 名（`fade`/`fly`/…），替代此前的占位 `preset${id}`。

## 2. 关键决策

**决策 1：只映射播放内核实现的效果，其余回落占位**

`PRESET_NAMES`（按 `presetClass` → `presetID` → 名）只收内核会画的入场/退场效果：entrance `1→appear / 2→fly / 10→fade`，exit `1→disappear / 2→fly / 10→fade`。未列的 id 回落 `preset${id}`（内核当作淡入）。emphasis 的 id 手头无把握，暂不映射（未知 emphasis 本就渲染为 identity）。

**决策 2：数值未核实，且刻意只影响播放、不影响文件**

权威表来自 [MS-OI29500]，本环境**取不到**（WebSearch 空、`learn.microsoft.com` 被拦、GitHub raw 下载超时）。故这些数字是**凭记忆的近似值**，代码里显著标注「UNVERIFIED，以 ECMA-376 为准」。关键安全性：**写回只用逐字保留的数字 `presetId`，从不用名字**——所以译错名字只会让*播放预览*里个别效果显示错，文件往返永远正确，且随时可改对。

## 3. 测试策略（TDD）

- **pptx-import**（+1 项，改 1 项）：已知 id 译成稳定名且逐字保留数字（entrance 10 → `fade` + presetId 10）；未映射 id 回落 `preset<id>`（entrance 777 → `preset777`）。
- **pptx-export**（改 2 项）：写回往返的期望时间线随之改用映射后的名（entrance 1 → `appear`、exit 10 → `fade`），验证 export→re-import 仍 `toEqual`——证明映射自洽、往返不坏。
- **回归**：pptx-import + pptx-export 全量 1046 项通过。改上游 pptx-import 后已 build 再跑下游。

## 4. 后续（本刀不含）

- 拿到 [MS-OI29500] 权威表后：补全 entrance/exit 全表、加 emphasis/motion 的 id、校正现有近似值（改 `PRESET_NAMES` 一处即可）。
- repeatCount 单位、motion path 路径建模（仍需外部验证）。

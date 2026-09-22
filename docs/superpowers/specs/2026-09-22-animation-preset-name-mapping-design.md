# 动画 presetID → 名映射设计

> 状态：已实现（数值经 LibreOffice 源核实，2026-09-22）
> 日期：2026-09-22

## 1. 目标

导入时把 OOXML 的数字 `presetID` 译成播放内核认识的稳定 preset 名（`fade`/`fly`/…），替代此前的占位 `preset${id}`。

## 2. 关键决策

**决策 1：只映射播放内核会画的效果，其余回落占位**

`PRESET_NAMES`（按 `presetClass` → `presetID` → 名）只收内核会区分渲染的：entrance/exit `1→appear/disappear、2→fly、10→fade、23→zoom`，emphasis `6→grow、8→spin、32→teeter`。未列的 id 回落 `preset${id}`（内核当作淡入）。

**决策 2：数值核实来源 + 只影响播放不影响文件**

`presetID` 是 PowerPoint 应用自定义值（OOXML 规范本身不枚举，[MS-OI29500] 只说 0=custom）。数值取自 **LibreOffice** 的 OOXML 导出映射（`oox/source/ppt/commontimenodecontext.cxx` 里 `ooo-<class>-<name>` ↔ id 表，逆向自 PowerPoint）——本会话经本地 clash 代理（`127.0.0.1:7897`）抓取核实（直连/搜索被限速时才走代理）。校正了先前凭记忆的近似：补齐 entrance/exit `23=zoom`、emphasis `6/8/32`；`1/2/10` 与记忆一致。

关键安全性：**写回只用逐字保留的数字 `presetId`，从不用名字**——所以名字纯属播放层，文件往返永远正确，将来要改也只动 `PRESET_NAMES` 一处。

## 3. 测试策略（TDD）

- **pptx-import**（+2 项，改 1 项）：已知 id 译成稳定名且逐字保留数字（entrance 10 → `fade` + presetId 10）；entrance 23 → `zoom`、emphasis 8 → `spin`；未映射 id 回落 `preset<id>`（entrance 777 → `preset777`）。
- **pptx-export**（改 2 项）：写回往返的期望时间线用映射后的名（entrance 1 → `appear`、exit 10 → `fade`），验证 export→re-import 仍 `toEqual`——证明映射自洽、往返不坏。
- **回归**：pptx-import + pptx-export 全量通过。改上游 pptx-import 后已 build 再跑下游。

## 4. 后续（本刀不含）

- 需要更多效果时按同源补 `PRESET_NAMES`（如 wipe=22 等，内核实现后再加）。
- repeatCount 单位、motion path 路径建模（motionpath 的 preset id 表同源已可查，路径几何仍需建模 + 验证坐标语义）。

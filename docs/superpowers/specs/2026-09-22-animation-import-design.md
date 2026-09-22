# 动画导入（p:timing → animations）设计

> 状态：已实现（导入方向，2026-09-22）
> 日期：2026-09-22

## 1. 目标

把幻灯片的 `p:timing` 树解析进模型的 `animations`（[动画模型](2026-09-22-animation-model-design.md)）。此前导入器完全不碰 timing，`animations` 从未被真实 pptx 填过。本刀只做**导入方向**；写回（编辑后回吐 `p:timing`）作为后续刀——现状下 `p:timing` 仍随 slide 源 XML 逐字保留，导入 `animations` 只是「多一层解析视图」，不影响往返（已由 export 全量 737 项验证）。

## 2. 关键决策

**决策 1：新建 spid→element 映射**

动画用 `p:spTgt/@spid`（drawingML 的 `cNvPr/@id`）指向形状，而导入器此前丢弃 `cNvPr` 全靠文档顺序编 `el_*`。故在形状遍历里对每个**已发出**的元素记 `cNvPr/@id → el_*`（`mapSpid`）。在空组裁剪之后再解析 timing，且解析器只解析到「仍存在于 `elements` 的」目标——目标不存在的 build 直接丢弃，保证 `animations` 恒过校验。

**决策 2：浅读深树——每个 effect 一个单 item build**

`p:timing` 的 `p:cTn` 嵌套很深。本刀只回收播放内核需要的信息：逐个「带 `presetClass` 的 effect `p:cTn`」→ 一个单 item 的 build。触发（onClick/withPrev/afterPrev）优先取 `@nodeType`（clickEffect/withEffect/afterEffect），回落到起始 `p:cond/@delay`。**不**重建 `p:cTn` 的精确分组：同时性由 `withPrev` 表达（`planTimeline` 会据此把它们并到同一步），而非把多 item 塞进一个 build。

**决策 3：presetID 逐字留存，preset 名先占位**

从 effect 取 `presetClass`→`class`、`@presetID`/`@presetSubtype` 逐字留存、`p:cBhvr/p:cTn/@dur`→`duration`、起始 `@delay`→`delay`。`preset`（内核用的稳定名）暂用占位 `preset${presetID}`——presetID→语义名的映射表未建（离线查不到权威表），内核对未知 entrance/exit 回落 fade，故占位可优雅降级；权威 id 已留存，后续补表与写回都能恢复。

**决策 4：interactiveSeq 的触发形状**

`nodeType="interactiveSeq"` 的 `p:seq`，其触发形状取自 seq 的 `prevCondLst/nextCondLst/stCondLst` 里第一个 `p:spTgt/@spid`，解析成 `AnimationBuild.triggerId`（[交互触发](2026-09-22-animation-interactive-triggers-design.md)）。

## 3. 测试策略（TDD）

- **animate 导入**（`animation-import.test.ts`，6 项，走真实 `importPptx` + 内存 zip）：mainSeq 解析成有序 build（onClick 入场 + withPrev 退场，含 presetID/duration/spid→el 解析）；presetID 逐字、preset 占位名；interactiveSeq 触发形状解析为 `triggerId`；产物过 `validateDocument`；目标形状不存在则丢弃该 build；无 timing 则 `animations` 不置。
- **回归**：pptx-import 全量 303 项、pptx-export 全量 737 项（证明导入 `animations` 不破坏往返）。改 model 后已先 build 再跑下游。

## 4. 后续（本刀不含）

- **写回方向**：编辑 `animations` 后回吐 `p:timing`（当前只逐字保留源 timing，模型编辑不落盘）。这是「写回镜像须与解析器对齐」的重点刀。
- presetID→稳定 preset 名映射表（双向）。
- effect 分组的更高保真（多 item/一 build、motion path 的路径数据、repeat/buildType）。
- rAF 驱动 + `paint()` 渲染集成。

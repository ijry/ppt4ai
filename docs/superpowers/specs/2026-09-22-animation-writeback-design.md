# 动画写回（animations → p:timing）设计

> 状态：已实现（写回方向，2026-09-22）
> 日期：2026-09-22

## 1. 目标

[导入](2026-09-22-animation-import-design.md) 之后的写回方向：把模型 `animations` 回吐成幻灯片的 `p:timing`。此前编辑 `animations` 不落盘（源 timing 逐字保留、模型改动被忽略）。本刀让编辑后的动画写进导出的 pptx。

## 2. 关键决策

**决策 1：契约是「模型往返」，不是「字节往返」**

导入是有损浅读（一 effect 一单 item build、preset 名占位、丢精确嵌套）。因此无法从模型逐字重建源 timing。写回的正确性契约定为：**导出的 `p:timing` 能被 `parseSlideTiming` 读回同一个模型**（`serializeTiming` 是解析器的忠实逆）。每个 item → 一个带 `presetClass`/`presetID`/`presetSubtype` 的 effect `p:cTn`；触发写成 `nodeType`（onClick→clickEffect / withPrev→withEffect / afterPrev→afterEffect）；delay 落在起始 `p:cond`，duration 落在 `p:cBhvr/p:cTn/@dur`；`targetId` 经反向 spid 映射写成 `p:spTgt/@spid`。

**决策 2：反向 spid 映射从扫描结果就地构建**

导出逐字保留源形状 XML、不重编号，故每个 `el_*`/`grp_*` 在输出里的 `cNvPr/@id` 就是导入当初记录的 spid。在 `replaceSlideTables` 里用 `scanned.elements` 建 `expectedId → cNvPr/@id`。reuse 模式下 `targetId===expectedId`（有 `strictIdentity` 断言兜底）；解析不到的目标（clone/blank 或形状已删）直接丢该 build。

**决策 3：字节恒等靠上游指纹短路，不在本函数比对**

`animations` 是文档顶层字段，纳入 `fingerprintDocument`；未编辑时 `exportPptx` 的指纹短路直接返回源字节，`timingReplacements` 根本不跑（`stays byte-identical` 测试即验此）。一旦文档被改（短路失效），timing 从模型确定性重生成——本刀不做「与源语义相等则 no-op」的比对，以免复制解析器逻辑造成镜像漂移。

**决策 4：交互按 triggerId 分组，一 trigger 一 seq**

解析器给一个 `interactiveSeq` 的所有 effect 赋同一个 `triggerId`，故写回把 interactiveSeq build 按 `triggerId` 分组，每个触发形状一个 `<p:seq nodeType="interactiveSeq">`，其 `prevCondLst` 的 `spTgt` 指向该形状。

## 3. 测试策略（TDD）

- **写回**（`animation-writeback.test.ts`，5 项，走真实 import→mutate→export）：`p:timing` 插在 `cSld` 之后且 `spid` 解析到 `cNvPr/@id`；主序列 export→re-import `toEqual`（onClick + withPrev，含 presetID/duration）；交互序列 export→re-import（`triggerId` 解析回 `el_*`）；模型去掉动画则删除 timing 节点；未编辑时字节恒等（指纹短路）。
- **回归**：pptx-export 全量 742 项、pptx-import 全量 303 项。改上游 pptx-import 后已先 build 再跑下游（下游吃 dist）。

## 4. 后续（本刀不含）

- presetID→稳定 preset 名映射表（双向），替换现在的占位名。
- 更高保真：多 item/一 build 分组、`repeat`/`buildType`、motion path 路径数据、emphasis 的 `p:animEffect`/`p:animRot` 行为节点（现统一用 `p:anim` 占位）。
- 与源 timing 的语义相等 no-op（避免非本意 churn），需复用解析器做结构比对。
- rAF 驱动 + `paint()` 渲染集成（把 override 真正画出来）。

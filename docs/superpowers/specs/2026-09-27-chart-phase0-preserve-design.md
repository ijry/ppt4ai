# 图表 Phase 0 设计：导入保真 + 一等占位元素

> 状态：设计待批准（2026-09-27）
> 日期：2026-09-27
> 上游：[[总体]] docs/superpowers/specs/2026-09-27-chart-subsystem-design.md 的 Phase 0。

## 1. 目标

让 PPTX 里的图表在编辑器里**看得见、可选/移/删/层级**，且导出**不破坏**其原始 chart 部件。本期**不解析**图表数据、**不原生绘制**（占位框），**不新建**图表——那些是 Phase 1-3。

## 2. 关键核实（本期基石，已用 code-trace 证）

问："图表现在导出会不会丢 / 会不会让写回错位？" 答：**当前不丢、不错位**，因为——

- importer 对每个 sp/graphicFrame/pic **无条件** `const id = el_${elementCounter++}`（`importer.ts:2023`），随后图表因 `parseTable` 找不到 `<tbl>` 返回 undefined 而 `continue`（`:2071`）——但 **el_N 槽已烧掉**。
- writeback 扫描对每个 sp/graphicFrame/pic 也 **无条件** `elementNumber += 1`（`writeback.ts:868`），仅当 `isImportableTable` 才把 graphicFrame 推入结果（`:874`）——图表**不推、但槽同样烧掉**。
- 两侧 el_N 计数**同步烧掉** → 编号不漂移；图表 graphicFrame 源 XML 无人替换、原样留存；chart 部件 + 内嵌 workbook 由依赖图 `clonePartDependencies` 随 slide 带走（`dependency-graph.ts`，已有 `x/chart` 递归克隆测试）。

⚠️ 这是 code-trace 结论，**Phase 0 第一步就是把它变成一条"先编辑再断言"的可执行测试**（见 §5.1），别停在"读代码觉得对"（[[ppt4ai-deferral-reasons-are-claims]] / [[ppt4ai-byte-roundtrip-cannot-prove-writeback]]）。

## 3. 本期改变了什么（以及随之而来的镜像约束）

一旦 importer **不再丢**图表、而是产出一个 el_N 的 chart 元素，写回的镜像就必须跟着改，否则两侧对 el_N 的认知分叉（[[ppt4ai-writeback-mirrors-must-match-parsers]]：漂移双向静默）：

- **importer 保留** → **writeback 扫描也必须把 chart graphicFrame 推入结果**（扩 `:874`，不再只认 importable table），否则 model 有 el_N=chart、scan 无 → 漂移。
- chart 元素**未改动**：graphicFrame 源 XML 原样保留（同今天）。
- chart 元素**改了 bounds/旋转/翻转**：只 patch graphicFrame 的 `a:xfrm`（同表格 bounds 写回的最窄节点替换），**不碰** chart 内部。
- chart 元素**被删**：移除该 graphicFrame 节点（其 chart 部件成为孤儿 → 交由既有依赖清理，或本期先只从 slide 摘除、部件留存，列入验证）。

<!-- APPEND-BELOW -->

## 4. 数据模型（Phase 0 最小）

```
ChartElement {
  kind: 'chart'
  id
  bounds { x, y, w, h }            // 来自 graphicFrame 的 a:xfrm
  transform?                        // rotation/flip，同其它元素
  source: {                         // 保真锚点：本期只透传，不解析内部
    chartRelId: string              // graphicData 内 c:chart 的 r:id
    // 缓存预览（若 PPT 存了）留待 §6 决定是否本期接
  }
}
```

本期**不含** chartType / series / categories / values —— 那是 Phase 1。`validateChart`：bounds 必需、`source.chartRelId` 必需。新增判别联合成员会波及所有 `switch(kind)`；靠 TS 穷尽性检查逐个补齐（engine/render/export/thumbnail）。

## 5. 构建顺序（每步 TDD、门禁看退出码 [[ppt4ai-gate-commands-read-exit-code]]、跨包先 build [[ppt4ai-cross-package-tests-need-build]]）

1. **锁定现状**：造一个带图表的最小 PPTX fixture（graphicFrame→c:chart→chart1.xml + 内嵌 workbook + 关系）；写"导入→编辑另一个元素→导出→断言 chart 部件与 graphicFrame 仍在、el 编号未错位"的测试。**先让它绿**（证 §2），作为后续改动的护栏。
2. **model**：加 `kind:'chart'` + `validateChart`（TDD）；顺 TS 报错补齐各 `switch(kind)` 的 chart 分支（多为透传/占位）。
3. **importer**：graphicFrame 分流——`<c:chart>` → ChartElement（bounds + chartRelId），保留 `<tbl>`→表格分支（TDD，用 §5.1 fixture）。
4. **render**：scenegraph 加 chart 节点；canvas painter 画**占位**（描边框 + "图表" 标签，居中）；缩略图同管线覆盖（TDD，ctx stub 断言调用序列）。
5. **writeback 镜像**：扫描把 chart graphicFrame 推入结果（扩 `:874`）；未改→原样，改 bounds/旋转→patch `a:xfrm`，删→摘 graphicFrame（TDD，全部"先编辑再断言"）。
6. **engine**：确认/补齐 move/resize/delete/zorder/group 对 chart kind 生效（多半 kind-无关，加测试兜底）。
7. **集成 + 门禁**：全仓 vitest + 各包 typecheck 退出码 0；相关包 build 绿。

## 6. 明确不在本期

- 解析 series/type、原生绘制真图（Phase 1）。
- 改数据/样式（Phase 2）、从零新建（Phase 3）。
- 内嵌 workbook 读写。
- 删除图表后 chart 部件的孤儿回收（本期先只从 slide 摘除；部件留存不算 bug，列入 Phase 2/依赖清理再处理）。
- 用 PPT 缓存预览图代替占位框（可选增强；若低成本可顺带，否则留后）。

## 7. 风险与待验证

- **判别联合扩员的涟漪**：`kind:'chart'` 会触达 engine/render/export/thumbnail 的每个 kind 分支；依赖 TS 穷尽性把面铺全，勿漏静默分支。
- **镜像漂移**（§3）：importer 一旦保留，writeback 扫描/编号/写回三处必须同步，否则双向静默错位——§5.1 的护栏测试专防这个。
- **删除语义**：摘 graphicFrame 后孤儿 chart 部件的处置本期从简，须在设计评审确认可接受。
- fixture 构造成本：需要一个结构正确的最小 chart PPTX；可参照 `dependency-graph.test.ts` 里的 `x/chart` 关系与 `test-fixtures.ts` 的建包方式。

## 8. 验收契约

- 带图表 deck：导入后图表**在画布/缩略图以占位显示**、可选中/移动/缩放/删除/调层级；对其它元素或图表本身做编辑后**导出，chart 部件与（未删时）graphicFrame 仍在、位置正确、编号不漂移**（护栏测试 + 写回测试）。
- 新增 model/importer/render/writeback 分支均有测试；全仓 `vitest run` + 各包 `typecheck` 退出码 0；相关包 `build` 通过。

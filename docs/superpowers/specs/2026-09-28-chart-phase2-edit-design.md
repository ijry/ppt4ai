# 图表 Phase 2 设计：编辑数据/样式 + 写回

> 状态：设计待批准（2026-09-28）
> 上游：总体 spec `2026-09-27-chart-subsystem-design.md` 的 Phase 2；接在 Phase 1（`2026-09-28-chart-phase1-render-design.md`，六型已端到端渲染，分支 commit 50）之后。

## 1. 目标

让用户在编辑器里**改图表数据/类型/配色**并**写回文件**：Inspector 图表面板改 series/类目/数值/类型/系列色，导出后 PowerPoint 打开能看到改动。Phase 1 是只读渲染，本期让它**可编辑**。

## 2. 现状核实（file:line，避免凭记忆）

- **无内嵌 workbook 处理**：全库 src 对 `embedding`/`externalData`/`xlsx`/`workbook` **零引用**（grep 过）。chart 部件、其 `.rels`、内嵌 `ppt/embeddings/*.xlsx` 目前都只是**被原样保留**，无人解析或改写。
- **输出=源部件全量保留 + 就地改**：`writeback.ts:2077` `retainedEntries = entries.filter(非孤儿)`，即所有源 zip 条目照抄，只对被编辑的条目(slide XML / content-types / presentation)`.data` 就地替换。**chart 部件至今没被写回碰过**（Phase 0/1 只 patch 外层 graphicFrame 的 `<p:xfrm>`）。
- **importer 只读缓存**：`parseChartPart` 读 `c:numCache`/`c:strCache` 的 `c:pt`（Phase 1）。chart 部件里同时有公式引用 `c:f`（如 `Sheet1!$B$2`）指向内嵌 workbook —— importer 忽略它、只取 cache。

## 3. 关键复杂点：写回要动两处，且分层

OOXML 图表的数据存**两份**:chart 部件里的**缓存**(`c:numCache`/`c:strCache`,PowerPoint 据此渲染)+ 内嵌 **workbook**(`c:f` 指向的 xlsx,"编辑数据"时的真源)。改一个值,保真上两处都该更新。故分层:

- **Tier A（缓存-only,本期主体）**:只 patch chart 部件的 `c:numCache`/`c:strCache`(+ 需要时 `c:ser` 的增删)。PowerPoint **渲染出改后的值**(它读 cache)。代价:"编辑数据"对话框仍显示旧 workbook 值,且用户在 PPT 里再编辑会用旧 workbook 覆盖。**渲染忠实、Edit-Data 会失同步**。
- **Tier B（连 workbook,后续/Phase 2b）**:同时改内嵌 xlsx 的单元格(它自身是嵌套 zip:`xl/worksheets/sheet1.xml` + `sharedStrings`)。**完全保真**但工程量大(嵌套 zip 读写)。

本期先交 **Tier A**,Tier B 单列(设计里标清代价,验收契约写明"渲染忠实、workbook 暂不同步")。

<!-- APPEND-BELOW -->

## 4. 架构落点

- **engine**：新增命令 `setChartData`（改 categories + series values）、`setChartType`（六型间切）、`setChartSeriesColor`。都改 `ChartElement` 的只读数据字段(Phase 1 加的)、走 `commit`、过 `validateChart`、可撤销。TDD。
- **host**：`presentation-host`/`asset-host` 加转发方法。
- **editor UI**：Inspector 加**图表面板**——类型下拉、系列/类目/数值的**数据网格**(小型可编辑表格)、每系列色。随选出现(选中 chart 元素时)。
- **render**：无需改(Phase 1 已从 `ChartElement` 数据算图元;改数据→新快照→重渲染,自动生效)。
- **writeback（本期新路径）**：chart 元素**数据变了**→ patch chart 部件 XML 的 `c:numCache`/`c:strCache`(改值、按 `ptCount`/`c:pt@idx` 增删点)。这是**全新的写回路径**——此前 chart 部件从不被改。放在 `replaceSlideTables`/依赖处理旁,按 el↔chartRelId→部件路径定位,改那个条目的 `.data`。

## 5. 镜像纪律（本期最吃紧）

写 chart 部件缓存的代码，必须与 importer 读缓存的代码**严格镜像**（[[ppt4ai-writeback-mirrors-must-match-parsers]]：加字段两侧一起改、漂移双向静默）：

- importer 的 `parseNumberCache`/`parseStringCache` 读 `c:pt@idx`+`c:v` → 写回必须按同一 `@idx` 语义回填,增删点时同步 `c:ptCount`。
- **写回不能靠字节往返自证**([[ppt4ai-byte-roundtrip-cannot-prove-writeback]]):必测"改值→导出→重新 import→值变了"的往返,不能只看"没编辑时字节一致"。
- **Phase 0 护栏保持绿**:没编辑图表时,chart 部件仍原样保留、外层 graphicFrame 仍只 patch xfrm。

## 6. 分块构建顺序（每块 TDD、门禁看退出码、跨包先 build）

1. **engine `setChartData`**（改 categories/series values，validateChart 兜底，撤销）。
2. **engine `setChartType` + `setChartSeriesColor`**。
3. **host 转发**（两层）。
4. **writeback：patch chart 部件缓存**（镜像 importer；核心测=改值往返断言）。
5. **Inspector 图表面板**（类型下拉 + 数据网格 + 系列色；happy-dom 挂载测）。
6. **集成 + 门禁**。

## 7. 明确不在本期

- **Tier B**：内嵌 workbook（xlsx）单元格同步——单列 Phase 2b。
- 从零新建图表（Phase 3）。
- 加/删**系列或类目条数**若牵动 `c:f` 公式范围重写：本期先支持**改值 + 定长增删点**；若增删导致公式范围失配，退保守（保留公式、只改 cache），复杂重写留后。
- 散点/雷达/3D 等非 v1 类型（总体 spec 非目标）；横向 bar 已可渲染。

## 8. 风险与待验证

- **Tier A 的 Edit-Data 失同步**是已知代价,不是 bug——验收契约写明,并在 UI/文档提示"改动已写入渲染缓存,PowerPoint 的编辑数据视图可能不同步"。**待与用户确认此代价可接受**。
- **c:f 公式与 cache 不一致**:改 cache 但不改公式,PowerPoint 多数按 cache 渲染;但若它重算公式(连着 workbook)可能覆盖。Tier A 的固有局限,Tier B 才根治。
- **增删点的 `c:ptCount` / 稀疏 idx**:必须与 importer 的 idx 语义对齐,否则读回错位。
- **多图表类型的 `c:ser` 结构差异**:bar/line/area/pie/doughnut 的 ser 结构一致(Phase 1 已验),写回复用同一 patcher。

## 9. 验收契约

- 选中图表→Inspector 改数值/类目/类型/系列色→画布即时重渲染;**导出→重新 import→数据/类型/色已变**(往返断言,非字节往返)。
- 没编辑图表时:**Phase 0 护栏仍绿**(chart 部件原样、字节一致)。
- 引擎命令/host/写回/面板各有测;全仓 `vitest` + 各包 `typecheck` 退出码 0;相关包 `build` 绿。
- 文档/UI 标明 Tier A 的 workbook 失同步代价。

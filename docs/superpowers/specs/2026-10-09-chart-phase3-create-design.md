# 图表 Phase 3 设计：从零新建图表

> 状态：设计待批准（2026-10-09）
> 分支：`feat/chart-create`(从 main 拉)。上游:总体 spec 的 Phase 3,接在 Phase 0/1/2(+2b)之后——那些让导入的图表能看/能改/能双写回;本期让**能新建**。

## 1. 目标

在编辑器里**插入一张新图表**并导出成 PowerPoint 能打开的文件:选类型 + 默认数据 → 画布渲染(复用 Phase 1 内核)→ 导出时**生成** chart 部件 + 内嵌 workbook + 关系。这是图表故事的收尾(导入保真 → 渲染 → 编辑 → **新建**)。

## 2. 现状核实（file:line）

- **standalone 拒绝**:`standalone.ts:97/226` 对 chart 元素抛 "does not support charts yet"。
- **writeback 新增只认图片**:`writeback.ts:1628/2001` 尾部新增 `element.kind !== 'image'` 即抛 "only supports trailing image additions"。
- 所以插入的图表**两条导出路径(新建 deck 的 standalone、编辑既有 deck 的 writeback 尾部新增)都不支持**。
- 引擎已有通用 `insertElements`(:665),插入 ChartElement 的**模型侧**基本现成;缺的是**导出侧生成**。

## 3. 关键区分:导入的 vs 新建的图表

- **导入的**:有 `chartRelId` + 一份被保留的源 chart 部件(Phase 0),改动走 Tier A/B patch。
- **新建的**:**没有源部件**,导出时必须**从 `ChartElement` 的数据生成** chartN.xml + embeddings/wbN.xlsx + 关系 + content-types。
- 判别:新建的 chart 元素没有可解析到源部件的 `chartRelId`(或带个显式"new"标记)。导出时:有源部件→保留/patch(现状);无→生成。

## 4. 架构落点

- **生成器(新,pptx-export)**:`serializeChartSpace(element) → chartN.xml`(c:chartSpace:plotArea + 对应 barChart/lineChart/… + c:ser 的 cat/val,带 strCache/numCache **和** c:f 指向 workbook)、`serializeChartWorkbook(element) → xlsx bytes`(用 `writeStoredZip` 建最小 xlsx:workbook.xml + sheet1.xml(类目/数值单元格)+ rels + [Content_Types])。这是 Tier A/B patcher 的"从零造"版,**与解析器/patcher 镜像**([[ppt4ai-writeback-mirrors-must-match-parsers]])。
- **standalone**:chart 分支不再抛——`serializeChartFrameXml`(graphicFrame + `<c:chart r:id>`)+ 把生成的 chart 部件/workbook 加进包 + 关系 + content-types override。镜像 `serializeTableFrameXml` 的加部件方式。
- **writeback 尾部新增**:放开"只认图片"——新 chart 元素→生成部件/workbook + 在 slide rels 加 chart 关系 + 在 spTree 末尾插 graphicFrame + content-types。
- **engine/host/UI**:插入默认 ChartElement(类型 + 示例数据)走 `insertElements`;顶栏"插入"加图表入口(选类型)。

<!-- APPEND-BELOW -->

## 5. 分块构建顺序（每块 TDD、门禁看退出码、跨包先 build）

1. **纯生成器**(最险、最该隔离测):`serializeChartSpace(element)` + `serializeChartWorkbook(element)`。单测:生成的 XML 能被 Phase 1 的 importer **解析回同样的 type/categories/series**(往返:element → 生成 → importPptx → 等值);workbook 的单元格值/类目与 c:f 范围一致。
2. **standalone 生成**:chart 分支接生成器,产出 graphicFrame + 部件 + workbook + 关系 + content-types。测:新建含图表的 deck → importPptx 能读回图表。
3. **writeback 尾部新增**:新 chart 元素 → 生成 + 挂关系 + 插 graphicFrame。测:导入 deck → 插图表 → 导出 → 重新 import 多了这张图表,原有元素不动、未改时字节一致。
4. **engine/host**:`insertChart`(或 insertElements + 默认 ChartElement 工厂:类型 + 示例 categories/series)。
5. **UI**:顶栏插入图表(选类型),复用 Inspector 图表面板改数据。

## 6. 待定/风险

- **新建 vs 导入的判别**:用"解析不到源部件的 chartRelId"还是加显式 `source?: {...}` 标记?倾向后者更清晰(Phase 1 已给 chartRelId 作导入锚;新建的留空/置 new)。**接口要定清**,别让导出侧猜。
- **关系 id / 部件编号分配**:新 chartN.xml / wbN.xlsx 的编号要避开既有(扫描现有 charts/embeddings 取 max+1);关系 id 同理(复用现有 `allocateRelationshipId`)。
- **content-types**:chart 部件(`application/vnd.openxmlformats-officedocument.drawingml.chart+xml`)、xlsx(`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`)的 override/default 要加;复用现有 content-types 重写机制。
- **镜像**:生成器必须和 importer 解析器、Tier A/B patcher 用同一套结构(ser/cat/val/numCache/strCache/c:f);三者漂移是静默 bug。往返测(块①)专防这个。
- **writeback 尾部新增的插入点**:现有 `appendBeforeSpTreeClose` 只插图片 XML;chart graphicFrame 走同一插入点,但要连带新关系/部件/content-types,比图片多几样。
- **最小可开 PowerPoint**:生成的 chartSpace 要含 PowerPoint 必需的最小节点集(plotArea + 至少一个 series + 轴 for cartesian);缺了可能打不开——用真 PowerPoint 核验(接线阶段)。

## 7. 明确不在本期

- 复杂图表样式(主题色、图例/数据标签精细排版)——先给能渲染、能打开的最小集。
- 散点/雷达/3D 等非 v1 类型(总体 spec 非目标)。
- 任意位插入排序(新图表先尾部追加)。

## 8. 验收契约

- 顶栏插入图表 → 画布出现(默认数据,Phase 1 渲染)→ 导出 → PowerPoint 能打开、显示该图表;重新 import 能读回其 type/categories/series。
- 既有元素不受影响;未插入/未改时导出字节一致(护栏)。
- 生成器往返测(element→生成→import 等值)、standalone、writeback 尾部新增各有测;全仓 `vitest` + 各包 `typecheck` 退出码 0;相关包 `build` 绿。
- 生成文件经真 PowerPoint 打开核验(接线阶段,非 headless)。

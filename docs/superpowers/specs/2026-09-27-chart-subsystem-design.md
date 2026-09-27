# 图表子系统设计（chart subsystem）

> 状态：设计待批准（2026-09-27）
> 日期：2026-09-27
> 前置纠错：`packages/charts` 是**空壳**（`src/index.ts` 只有 `export {}`）。此前交接/记忆里"charts 已存在待接"的说法有误——图表是**从零子系统**，不是接线活。

## 1. 目标与范围

给 ppt4ai 补上**图表**能力，按 PPT 保真优先的一贯路线分期落地：**先不丢、再能看、再能改、最后能建**。一次做全不现实（OOXML 图表极复杂），故本 spec 只定**总体架构 + 分期切法 + 每期的独立 spec/plan 边界**；每期实现另出细化 design（参照动画子系统的拆法：`2026-09-22-animation-*`）。

- **复用**：canvas 渲染管线（scenegraph → SlideCanvas）、pptx-import/export 的定位式写回、`presentation-host`/`asset-host` 动作门面、编辑器四区外壳（Inspector 挂图表面板）。
- **`packages/charts` 定位** = **纯图表布局内核**（数据 → 几何图元，零框架，同 geometry/text/layout 包），被 render 消费；不放 UI、不碰 DOM。
- **非本 spec**：AI 生成子系统（另有独立 spec）。

## 2. 现状核实（附 file:line，避免凭记忆）

- **空壳**：`packages/charts/src/index.ts` = `export {}`；package.json exports 指向 dist，但零实现。
- **model 无 chart 类型**：元素 kind 只有 group/image/shape/text/table（`packages/model/src/index.ts`）。render/engine 全库零 `chart` 引用。
- **导入即丢**：importer 收集 `graphicFrame`（`importer.ts:904`），但 graphicFrame 一律走 `parseTable`（`:2068-2070`）；`parseTable` 找 `<tbl>`（`:777`），图表无 tbl → 返回 undefined → `if (!element) continue`（`:2071`）**丢弃**：不进模型、不渲染、不可选。
- **写回疑似保留**：writeback 定位式匹配 sp/graphicFrame/pic（`writeback.ts:866`），仅当 `isImportableTable` 为真才替换 graphicFrame（`:874`），注释称 "unknown siblings survive"（`:1363`）——图表源 XML **很可能被原样保留**。⚠️ 但这是**待验证断言**（见 [[ppt4ai-deferral-reasons-are-claims]]）：被丢弃的图表是否会让写回的定位映射错位，必须在 Phase 0 用"先编辑再断言"的测试证实（[[ppt4ai-byte-roundtrip-cannot-prove-writeback]]），不能靠字节往返判定。

## 3. 架构落点

一张图表在 OOXML 里 = slide 上一个 `<p:graphicFrame>`，其 `<a:graphicData uri=".../chart">` 内含 `<c:chart r:id>` 指向独立部件 `/ppt/charts/chartN.xml`（`<c:chartSpace>`：plotArea / series / cat / val / axes / legend），通常再挂一个内嵌工作簿 `/ppt/embeddings/*.xlsx` 存数据。各件落点：

- **model**（packages/model）：新增 `kind: 'chart'` 元素（判别联合新成员）+ `validateChart`（沿用 validate* 风格）。承载 bounds/transform（同其它元素）、图表类型、series/categories/values、基本样式（配色、图例/数据标签开关），以及**保真兜底**——无法建模的 OOXML 特性保留原始引用/透传标记（"能建模的进结构、建不了的留原样"）。
- **packages/charts**（纯内核）：`layoutChart(spec, box) → 图元`（轴/网格/柱/线/扇区/标签的几何），框架无关、纯函数、可单测；render 调用它。
- **importer**（pptx-import）：graphicFrame 分流——有 `<tbl>` → 表格（现状）；有 `<c:chart>` → 解析 chart 部件为 chart 元素（type + series/cat/val + 基本样式）。
- **render**（packages/render）：scenegraph 加 chart 节点；canvas painter 画轴/系列/图例；缩略图走同一管线自然覆盖。
- **export**（pptx-export）：写回改 chart 部件 XML + 内嵌工作簿（surgical patch，镜像 importer 解析器见 [[ppt4ai-writeback-mirrors-must-match-parsers]]）；standalone-xml 生成新 chart 部件 + 关系 + workbook。
- **editor/host**：`presentation-host`/`asset-host` 加 `insertChart`/`setChartType`/`setChartData` 等；Inspector 加图表面板（类型切换 + 数据网格 + 配色）；顶栏"插入"加图表入口。

<!-- APPEND-BELOW -->

## 4. 数据模型（草图，细化留 model 期 spec）

```
ChartElement {
  kind: 'chart'
  id; bounds { x, y, w, h }; transform?          // 同其它元素，复用几何/旋转/翻转
  chartType: 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut'
  categories: string[]                            // 类目轴标签（c:cat）
  series: { name?: string; values: number[]; color?: Color }[]   // c:ser → c:val
  legend?: boolean; dataLabels?: boolean; title?: TextBody
  // 保真兜底：能建模的进上面结构，建不了的（次轴/趋势线/复杂样式）留原样引用
  source?: { chartPartRef: string; workbookRef?: string }
}
```

强调：**结构承载常见形态，冷门特性靠 `source` 透传**，避免为覆盖 OOXML 全集把模型撑爆。

## 5. 分期（每期独立 spec + plan + 一批小 commit）

- **Phase 0 — 不丢 + 占位（保真 floor）**：graphicFrame 分流出 chart；chart 落成**一等元素**（有 bounds、可选/移/删/层级）；画布与缩略图显示占位（优先用 PPT 内嵌的图表预览图，无则框 "图表" 占位）；写回保留 chart 部件 XML 原样。**验收：带图表的 deck 编辑其它元素后导出，图表不丢、位置对**（先编辑再断言）。
- **Phase 1 — 原生渲染（只读）**：`packages/charts` 内核 + importer 解析 series/cat/val + render 画柱/条/线/面/饼。图表"看得见、缩略图对"，仍不可改数据。先支持最常见类型（见 §6）。
- **Phase 2 — 改数据/样式**：Inspector 图表面板（数据网格改 series/cat/val、类型切换、配色/图例/数据标签开关）；写回 chart 部件 + 内嵌工作簿。
- **Phase 3 — 从零新建**：插入 → 默认数据的新图表元素 + 新 chart 部件/关系/workbook（standalone 生成）。

每期都：TDD（内核/引擎命令/解析器纯函数先测）、门禁看退出码（[[ppt4ai-gate-commands-read-exit-code]]）、跨包改动先 build 再跑下游测试（[[ppt4ai-cross-package-tests-need-build]]）。

## 6. OOXML 范围与非目标（v1）

- **v1 类型**：柱/条（clustered / stacked）、折线、面积、饼 / 环。
- **非目标（后续或不做）**：散点/气泡/雷达/股价/曲面、3D、组合图、次坐标轴、趋势线/误差线、复杂数据标签排版、图表内动画（属动画子系统）。遵循"能建模的进结构、建不了的原样保真"。

## 7. 风险与待验证

- **待验证**（Phase 0 首件）：§2 的"图表原样保留"是断言，须用"先编辑再断言"的写回测试证实，别当既成事实。
- OOXML 图表规模庞大 → 靠严格分期 + 明确非目标控制爆炸半径。
- 内嵌工作簿（xlsx）读写：Phase 2 才碰；先只读缓存值，**不重算公式**。
- 渲染保真：原生绘制与 PowerPoint 不会像素级一致；目标是"结构与数值忠实、观感接近"，同 pattern `pctNN` 按覆盖率近似的既有取舍。

## 8. 测试策略

- `packages/charts` 内核：纯函数单测（数据 + box → 图元坐标）。
- importer：chart XML 片段 → chart 元素 的解析单测。
- render：happy-dom + canvas ctx stub，断言 painter 调用序列（同现有 scenegraph 测法）。
- engine/host：`insertChart`/`setChartType`/`setChartData` 命令 TDD。
- export：**先编辑再断言**的写回测试（不靠字节往返 [[ppt4ai-byte-roundtrip-cannot-prove-writeback]]）。
- editor：Inspector 图表面板 happy-dom 挂载测。

## 9. 验收契约（按期）

- **Phase 0**：带图表 deck 编辑后导出图表不丢、位置正确；图表可选/移/删；有测试。
- **Phase 1**：v1 类型在画布/缩略图正确渲染（结构 + 数值忠实）；有内核/解析/渲染测试。
- **Phase 2**：可改 series/cat/val/类型/配色并写回（部件 + workbook）；有写回测试。
- **Phase 3**：可插入新图表并 standalone 导出、能被 PowerPoint 打开。
- **每期**：全仓 `vitest run` + 各包 `typecheck` 退出码 0；相关包 `build` 通过。

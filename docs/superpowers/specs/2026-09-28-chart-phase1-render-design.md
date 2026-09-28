# 图表 Phase 1 设计：原生渲染（只读）

> 状态：设计待批准（2026-09-28）
> 上游：总体 spec `2026-09-27-chart-subsystem-design.md` 的 Phase 1；接在 Phase 0（`2026-09-27-chart-phase0-preserve-design.md`，已完成到分支 commit 42）之后。

## 1. 目标

把 Phase 0 的**占位框**换成**真正画出来的图表**（只读）：解析 chart 部件的类型/系列/类目/数值，用 `packages/charts` 纯内核算几何，render 画柱/条/线/面/饼/环。仍**不可编辑数据**（Phase 2）、**不新建**（Phase 3）、**不写回数据变更**。保真：chart 部件本体继续原样保留（Phase 0 已保证，护栏测试守着）。

## 2. 现状（Phase 0 交接）

- `ChartElement` 只有 bounds + rotation/flip + `chartRelId`（**不含数据**）。
- importer `parseChart(frame, id)` 只读 `chartRelId`，**不碰 chart 部件**。
- render `SceneChartNode` 只有几何，`paintChartNode` 画占位框。
- `packages/charts` = `export {}` 空壳。

## 3. 架构落点

- **`packages/charts`（纯内核，本期真正落地）**：`layoutChart(spec, box) → ChartPrimitives`。入参=归一化图表规格（类型+系列+类目+数值+样式）、box=EMU 矩形；出参=一组绘制图元（轴线、网格线、柱/条矩形、折线/面积折点、扇区、文本锚点），全在 box 局部坐标。**框架无关、纯函数、可单测，不依赖 canvas/DOM**。
- **model**：`ChartElement` 扩数据字段（`chartType`、`categories`、`series`、可选 `legend`/`dataLabels`）；`chartRelId` 保留作保真锚。`validateChart` 扩这些字段。
- **importer**：`parseChart` 收一个 media-like 上下文（slidePath/slideRelations/entries，同 `parseTable` 的 `tableMedia`），用 `chartRelId` 解析出 chart 部件路径、解析 `c:chartSpace`（`c:barChart`/`c:lineChart`/`c:pieChart`… → `c:ser` → `c:cat`/`c:val` 的 cache）成上面的数据。解析不了的类型 → 退回占位（`chartType:'unknown'`，仍保真）。
- **render**：`SceneChartNode` 携带解析后的 spec（颜色经 theme resolve）；`paintChartNode` 调 `layoutChart` 拿图元、映射到 canvas 画；占位框只在 `unknown`/无数据时兜底。
- **editor 两画笔**：slide-canvas + thumbnail 同步（继续复用同一个 `paintChartNode`）。

<!-- APPEND-BELOW -->

## 4. 数据模型（草图，细化留 model 块）

```
ChartElement {
  kind: 'chart'; id; bounds; rotation?; flipH?; flipV?
  chartRelId                       // 保真锚（Phase 0）
  chartType?: 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'unknown'
  categories?: string[]            // c:cat 缓存
  series?: { name?: string; values: (number | null)[]; color?: Color }[]   // c:ser → c:val 缓存
  legend?: boolean; dataLabels?: boolean
}
```

只读 **缓存值**（`c:numCache`/`c:strCache`），**不重算公式**、不碰内嵌 workbook（那是 Phase 2 编辑才需要）。`null` 值 = 缺口，画图跳过该点。

## 5. `packages/charts` 内核 API（草图）

```
interface ChartSpec { type; categories: string[]; series: { name?; values: (number|null)[]; color?: string }[] }
interface ChartPrimitives {
  bars?: { x; y; w; h; color }[]; polylines?: { points: Point[]; color }[]; areas?: { points: Point[]; color }[]
  sectors?: { cx; cy; r; innerR?; start; end; color }[]; axes?: Line[]; gridlines?: Line[]; labels?: { text; x; y; align }[]
}
function layoutChart(spec: ChartSpec, box: Rect): ChartPrimitives
```

- v1 类型：column/bar（clustered + stacked）、line、area、pie/doughnut。
- 轴：类目轴 + 数值轴，自动量程（0 基线、nice 步长）。颜色：系列自带 → 否则默认调色板（品牌中性色，见 dataviz skill 的 palette）。

## 6. 分块构建顺序（每块 TDD）

1. **内核 column/bar**：纯函数（数据 + box → bars + axes + labels）；量程/nice 步长/堆叠都是纯计算，最好测。
2. **model 扩字段 + validateChart**：顺 TS 补各 `switch(kind)`（多为透传）。
3. **importer 解析 chart 部件**：`chartRelId` → part → `c:chartSpace` → 数据；先只认 `barChart`。TDD 用 chart XML 片段。
4. **render 画柱/条**：`SceneChartNode` 带 spec、`paintChartNode` 调内核；占位仅兜底。ctx-stub 测。
5. **line/area/pie/doughnut**：内核 + render 逐类型加。
6. **thumbnail 对齐 + 集成**：导入带图表 deck → 缩略图有真图；门禁。

跨包改动先 build 再跑下游（[[ppt4ai-cross-package-tests-need-build]]）；门禁看退出码（[[ppt4ai-gate-commands-read-exit-code]]）；importer/model 改动影响下游，注意 build 顺序。

## 7. 明确不在本期

- 编辑数据/类型/颜色（Phase 2）、新建（Phase 3）、写回数据变更、内嵌 workbook 读写、公式重算。
- 散点/气泡/雷达/股价/3D/组合图/次坐标轴/趋势线（总体 spec 非目标）。
- 图例/数据标签的复杂排版：先给最简（图例可选、标签可选）。

## 8. 风险与待验证

- **importer 能否拿到 chart 部件**：`parseChart` 需要 slideRelations + entries（`parseTable` 的 `tableMedia` 已是先例）——**接线时验证**，别假定 chartRelId 一定能解析到 part。
- **缓存缺失**：有的文件 `c:cat`/`c:val` 只有公式引用、无 cache → 本期退回占位（保留 `chartType`、数据留空），**不猜数值**。
- **保真**：原生绘制与 PowerPoint 非像素级一致（同 pattern `pctNN` 近似的既有取舍）；目标"结构 + 数值忠实"。
- **内核体量**：严格按类型分块，先把 column/bar 一条龙（内核→解析→渲染）跑通，再铺其余，控爆炸半径。

## 9. 验收契约

- 导入含 column/bar 图表的 deck：画布/缩略图画出**坐标轴 + 柱子 + 类目/数值标签**，数值忠实；line/area/pie/doughnut 同。
- 解析不了的类型 / 无 cache：**退回占位**，不崩、不丢部件。
- 内核 / 解析 / 渲染各有测试；全仓 `vitest run` + 各包 `typecheck` 退出码 0；相关包 `build` 绿。
- **Phase 0 的护栏与写回测试保持绿**（chart 部件仍原样保留、编辑相邻元素不扰动图表）。

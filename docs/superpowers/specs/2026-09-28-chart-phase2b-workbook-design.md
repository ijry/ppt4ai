# 图表 Phase 2b 设计：内嵌 workbook 同步（Tier B）

> 状态：设计待批准（2026-09-28）
> 上游：Phase 2（`2026-09-28-chart-phase2-edit-design.md`）的 Tier B；接在 Tier A（已做，chart 部件缓存写回，分支 commit 54 / PR #2）之后。

## 1. 目标

根治 Tier A 的已知代价:改图表数据时,**同时更新内嵌 workbook 的单元格**,让 PowerPoint「编辑数据」视图与渲染一致、且在 PPT 里再编辑不会用旧值覆盖。Tier A 只改 chart 部件缓存(渲染忠实);Tier B 把改动也写进 `ppt/embeddings/*.xlsx`。

## 2. 可行性核实（关键,已查）

- **嵌套 zip 能读写**:内嵌 xlsx 是 pptx zip 里的**一个条目,自身又是个 zip**(通常 DEFLATE 压缩)。`pptx-export/src/zip.ts` 的 `readZipEntries` **会 inflate**(method 8 走 `DecompressionStream('deflate-raw')`,zip.ts:79),`writeStoredZip` 写 stored(method 0)。所以:读外层条目字节 → `readZipEntries(xlsxBytes)` 得内层条目(sheet XML 等,已解压)→ 改单元格 → `writeStoredZip(内层)` → 覆盖外层条目。**机制可行,复用现成工具**(都在 pptx-export 内,直接 import `./zip.js`,无跨包问题)。
- **零现有处理**:全库对 embeddings/externalData/xlsx 零引用——从零做。
- **异步**:inflate 是 async;exportPptx 已是 async,Tier A 的 chart patch 循环要改成 await。

## 3. 定位链（chart 元素 → workbook xlsx）

1. chart 元素 → `chartRelId` → slide rels → chart 部件路径(Tier A 已有)。
2. chart 部件的 `.rels`(`ppt/charts/_rels/chartN.xml.rels`)里,`<c:externalData r:id>` 指的那条关系(type `.../relationships/package`)→ `../embeddings/*.xlsx` 路径。
3. 外层 entries[xlsxPath] 的字节 = 内嵌 workbook。
⚠️ 第 2 步的 externalData/package 关系类型是**标准结构、但待实现时用真文件核实**([[ppt4ai-deferral-reasons-are-claims]]);有的图表**没有 `c:externalData`**(数据只在缓存里、无 workbook)→ 那种 Tier A 已足够,Tier B 直接跳过。

<!-- APPEND-BELOW -->

## 4. 单元格定位：靠 `c:f` 公式范围

chart 部件里每个 series 的 `c:val/c:numRef/c:f` 是单元格范围(如 `Sheet1!$B$2:$B$3`),`c:cat/.../c:f` 是类目范围(如 `Sheet1!$A$2:$A$3`)。解析范围 → 值索引 i 映射到具体单元格(B2=idx0、B3=idx1…)→ 在 sheet XML 里定位 `<c r="B2"><v>…</v></c>` 改其 `<v>`。**无 `c:f` 时**该 series 没有 workbook 支撑 → 跳过(Tier A 兜底)。sheet 名从 `c:f` 的 `Sheet1!` 前缀取,映射到 `xl/worksheets/sheetN.xml`(经 `xl/workbook.xml` + 其 rels)。

## 5. 分层(Tier B 内部再分)

- **B1 — 数值单元格(本期主体)**:数字单元格是 `<c r="B2"><v>10</v></c>`(无共享串)→ surgical 改 `<v>`,同 Tier A 的数值比较(数值变了才改、否则不动)。这是用户最常改的。
- **B2 — 类目字符串(后续)**:类目多为共享串 `<c r="A2" t="s"><v>0</v></c>`(`<v>` 是 sharedStrings 索引)或内联 `t="str"/"inlineStr"`。改标签要动 `xl/sharedStrings.xml`(改/加串 + 维护 count/uniqueCount)或内联串——明显更复杂,单列 B2。

## 6. 镜像纪律(Tier A ↔ Tier B 必须一致)

同一次编辑,**chart 部件缓存(Tier A)和 workbook 单元格(Tier B)要一起改、改成同一个值**,否则两处不一致 = 又一种失同步。所以 Tier B 的单元格 patcher 与 Tier A 的 `patchChartCache` **共享同一份"变了才改、数值按数值比"的判定**([[ppt4ai-writeback-mirrors-must-match-parsers]])。**没编辑就都不动** → Phase 0 护栏 + Tier A 的字节一致继续成立(外层 xlsx 条目不重写)。

## 7. 分块构建顺序（每块 TDD、门禁看退出码）

1. **纯 helper `patchWorkbookCells(xlsxBytes, cellEdits) → xlsxBytes`**:读内层 zip → 改 sheet `<c><v>` → 写回。**先单测**(改一个数值单元格、没变则内层字节稳定、无 sheet 则原样)。这是最险的一环(嵌套 zip + 偏移改写),隔离 TDD。
2. **`c:f` 范围解析**(纯函数:`Sheet1!$B$2:$B$3` + 值数组 → {sheet, cell→value} 编辑列表)。纯,好测。
3. **writeback 接线**:Tier A patch 之后,若 chart 有 `externalData` → 解析 c:f → patchWorkbookCells → 覆盖 xlsx 条目。async。
4. **往返测**:改值 → 导出 → 读回内嵌 xlsx 的单元格 = 新值(且 chart 缓存也 = 新值,两处一致)。
5. B2(类目/共享串)另起。

## 8. 明确不在本期（B2 及以后）

- 类目字符串 / sharedStrings 改写(B2)。
- 增删行列(改 workbook 维度 + `c:f` 范围 + `<dimension>`)——大改,远期。
- 公式重算 / 图表样式主题写回。
- xlsx 输出保持 stored(不压缩):体积略大但合法,PowerPoint 可读;若要保持 DEFLATE 需给 writeStoredZip 加压缩——非本期。

## 9. 风险与待验证

- **externalData 关系类型 / sheet 名映射**:标准但用真文件核实(§3)。
- **stored vs DEFLATE 输出**:外层 pptx 里的 xlsx 条目本是压缩的,我们改后写成 stored → 外层条目字节变大、且**编辑过的图表其外层 xlsx 条目不再字节一致**(这是"改了数据"的预期,不是护栏违反;护栏只保证"没编辑时"一致)。
- **共享串索引漂移**(B2 专属):改一个类目若复用/新增共享串,索引维护错会串味,故 B2 单列、谨慎。
- **无 `c:f` / 无 externalData 的图表**:跳过 Tier B,Tier A 已忠实渲染。

## 10. 验收契约

- 改图表数值 → 导出 → 读回**内嵌 xlsx 对应单元格 = 新值**,且 chart 部件缓存也 = 新值(两处一致)。
- 没编辑图表:外层 xlsx 条目不动、Phase 0 护栏 + Tier A 字节一致仍绿。
- helper / c:f 解析 / 写回往返各有测;全仓 `vitest` + 各包 `typecheck` 退出码 0;相关包 `build` 绿。
- B2(类目串)明确留待后续。

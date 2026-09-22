# 动画 presetClass 词表修正设计

> 状态：已实现（修正，2026-09-22）
> 日期：2026-09-22

## 1. 问题

导入/写回把 OOXML 的 `@presetClass` 当成完整词（`entrance`/`exit`/`emphasis`/`motion`）来匹配/输出。但 OOXML `ST_TLTimeNodePresetClassType` 的真实取值是**缩写** `entr`/`exit`/`emph`/`path`（另有 `verb`/`mediacall`）——经 LibreOffice `oox/source/ppt/commontimenodecontext.cxx`（`case XML_entr → ENTRANCE …`）核实。

后果：**真实 PowerPoint 文件的 entrance/emphasis/motion 动画会被导入器丢弃**（只有 `exit` 碰巧同名能过）；写回也吐出 PowerPoint 不认的 `presetClass="entrance"`。此前测试用例误用了完整词，导入/写回互为镜像所以「模型往返」测试仍绿，但两侧都偏离真实格式——正是「镜像自洽 ≠ 格式正确」的坑。

## 2. 关键决策

模型保留友好名（`entrance`/`exit`/`emphasis`/`motion`），在 IO 两侧做词表翻译：

- **导入**（`timing.ts`）：`CLASS_BY_OOXML = { entr→entrance, exit→exit, emph→emphasis, path→motion }`；`verb`/`mediacall`（OLE/媒体触发，不建模）丢弃。
- **写回**（`writeback.ts`）：`OOXML_PRESET_CLASS = { entrance→entr, exit→exit, emphasis→emph, motion→path }`。

## 3. 测试策略（TDD）

- 修正导入测试 fixture 用真实 token（`presetClass="entr"` 等）；写回测试新增断言 `presetClass="entr"`（模型 `entrance` 写回成 OOXML token）。
- 模型往返（export→re-import `toEqual`）仍绿，且现在两侧都对齐真实 OOXML。
- 回归：pptx-import + pptx-export 动画相关全绿。改上游 pptx-import 后已 build 再跑下游。

## 4. 影响

这是让**真实 pptx 动画能被导入**的前提修正，也为 motion（`path`）打开了通路（见 motion path 设计）。

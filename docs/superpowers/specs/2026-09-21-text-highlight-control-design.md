# 文字高亮编辑控件设计

> 状态：已实现（2026-09-21）
> 日期：2026-09-21

## 1. 目标

给文字工具栏加**高亮(`a:highlight`)编辑控件**。此前模型/导入/场景/绘制/写回都已支持 highlight,唯独没有编辑入口——用户改不了它。这是第一刀「把已就绪的往返能力接上编辑器 UI」。

## 2. 关键决策

**决策 1：`TextFormattingState` 加 `highlight?: Color`,与 `color` 平行**

`@ppt4ai/text` 的 `formatting.ts`:`highlight` 进 `markNames`、`TextMarksPatch` 天然支持(它是 `TextMarks` 的映射)、`getTextFormattingState` 用 `reduceScalar` 归约(多 run 不一致则 `undefined` 即"混合")、`validatePatch` 用新的 `isColor` 校验(highlight 是纯色 `Color`,不是 `Fill`)。

**决策 2：工具栏加一个 color input + 清除按钮**

`TextFormattingToolbar.vue`:`highlight()` 发 `set-marks { highlight: {type:'srgb',v} }`,`clearHighlight()` 发 `set-marks { highlight: undefined }`(清除按钮在无高亮时禁用)。控件带 `data-text-highlight`/`data-text-highlight-clear`。en/zh 各加 `highlight`/`highlightClear` 文案。

## 3. 测试策略（TDD）

- **格式化状态**（`text/editor/formatting.test.ts`,+4 项）：设置/读回 highlight;清除;拒绝非法色;多 run 不一致报 `undefined`。
- **工具栏**（`editor/TextFormattingToolbar.test.ts`,更新)：按钮数 6→7、色板 1→2、禁用计数;第二测试补一条 highlight 发射断言。
- **回归**：全量 2447 项。

## 4. 已知限制

- 高亮控件在文字工具栏,PptEditor.vue 已挂载该工具栏并把 set-marks 接到 	extBoxRef.setMarks,因此高亮从工具栏到模型端到端可用(playground 用的就是 PptEditor)。
- 高亮仅纯色(OOXML 本身如此)。

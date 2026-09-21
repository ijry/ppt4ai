# 文字高亮 a:highlight 设计

> 状态：已实现（2026-09-21）
> 日期：2026-09-21

## 1. 目标

给 run 级文字补上 `a:highlight`（文字背景高亮色）。它是 `CT_TextCharacterProperties` 上一个独立的纯色元素，和现有的 run 颜色（`a:solidFill` → `TextMarks.color`）平行，此前完全没有建模。

## 2. 当前状态（实测）

`TextMarks` 有字体/字号/粗斜体/下划线/颜色/基线，唯独没有 highlight。导入 `parseRunProperties` 只读 `solidFill`，导出 `serializeMarks` 只写颜色，场景 run 只解析 `resolvedColor`，绘制只画字形与下划线。

## 3. 关键决策

**决策 1：`TextMarks.highlight?: Color`（纯色，非 Fill）**

OOXML 的 `a:highlight` 是 `CT_Color`，只能是纯色（不像填充可渐变/图案），所以字段类型是 `Color` 而非 `Fill`。校验复用 `validateColor`。

**决策 2：导入/导出在颜色与字体之间接入**

`CT_TextCharacterProperties` 的顺序是 fill → highlight → 字体（latin/ea/cs）。导入在读完 `solidFill` 后读 `highlight`；导出 `serializeMarks` 在 `serializeFillXml(marks.color)` 之后、`serializeTypefaces` 之前插入 `<a:highlight>`。写回随文本整体走 `serializeTextBodyXml` → `serializeMarks`，因此自动覆盖。

**决策 3：场景解析 `resolvedHighlight`，绘制画在字形之前**

run 映射用 `resolveColor(run.marks.highlight, theme, colorMap)` 得到 `SceneTextLayoutRun.resolvedHighlight`。绘制端 `paintHorizontalItem` 在 `applyTextStyle`/`fillText` 之前，用排版给出的 run 行内框 `(item.x, line.y, item.width, line.height)` 画一个背景矩形（`textBaseline='top'`，文字画在 `line.y`，所以矩形与字形对齐）。竖排暂不画高亮（另一套坐标，未建模需求）。

## 4. 测试策略（TDD，逐层）

- **导入**（`pptx-import/text-highlight.test.ts`，3 项）：读出 highlight；与 fill 颜色不混淆；无则不设。
- **场景**（`render/text-highlight.test.ts`，3 项）：直接色解析；scheme 色经主题解析；无则不带。
- **绘制**（`editor/text-highlight-painting.test.ts`，2 项）：在字形前按行高画矩形；无高亮不画。
- **写回**（`pptx-export/text-highlight-writeback.test.ts`，3 项）：导入 highlight；未编辑逐字节相同；编辑文本触发重写时 `a:highlight` 写在 fill 之后。
- **回归**：全量 2403 项。

## 5. 已知限制

- 竖排文字不画高亮块（横排已支持；竖排是独立坐标，按需再补）。
- 没有编辑入口（工具栏无高亮按钮，与很多 run 标记一样，只做读取→解析→绘制→写回）。
- highlight 只支持纯色（OOXML 本身如此）。

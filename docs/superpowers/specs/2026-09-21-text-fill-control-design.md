# 文字 run 渐变/图案填充编辑控件设计

> 状态：已实现（2026-09-21）
> 日期：2026-09-21

## 1. 目标

文字工具栏此前只能设纯色字体色(+高亮)。run 的渐变/图案填充已能绘制(横/竖三态)并往返,但没有编辑入口。这一刀补上,与背景面板的渐变/图案编辑器同构。

## 2. 关键决策

**决策 1：run 填充就是 `TextMarks.color`(一个 `Fill`),所以复用 `set-marks`**

字体色 mark 本就是 `Fill`,渐变/图案只是同一个 `Fill` 带 `gradient`/`pattern`。因此渐变/图案控件发的仍是 `set-marks { color: <Fill> }`,engine 与往返本就支持,无需新命令。

**决策 2：`text-formatting-toolbar.ts` 加纯函数构造器 + 编辑器状态派生**

`textFillEditorState(fill)` 把当前 `color` 拆成三套编辑器字段(纯色/渐变起止角/图案预设两色);`textGradientFrom`/`textPatternFrom` 构造 `Fill`(与背景面板的 `backgroundGradientFrom`/`backgroundPatternFrom` 同规则:拒非法输入、图案预设限 `PAINTED_PRESET_PATTERNS`、`color` 镜像图案前景)。全部可 headless 单测。

**决策 3：工具栏加渐变(起/止/角)与图案(预设+两色)控件**

各控件 change 时从 `fillEditor` 读另两项合成 `Fill` 发 `set-marks`。`PptEditor.vue` 已把 `@set-marks` 接到 `textBoxRef.setMarks`,因此端到端可用。en/zh 加六条文案。

## 3. 测试策略（TDD）

- **构造器**（工具栏单测,+1）：改渐变起色→发两停靠点 fill;改图案预设→发 pct25 图案 fill(前景镜像)。
- **计数**：按钮 7、select 3→4、色板 2→6、禁用计数同步更新。
- **回归**：全量 2461 项。

## 4. 已知限制

- 渐变限两停靠点线性;图案限可画预设(与背景面板一致)。
- 竖排选区里的运行仍按现有绘制(渐变/图案的横竖三态绘制已在早前完成)。

**至此:纯色/渐变/图案填充在形状(既有)、幻灯片背景、文字 run 三处都可视化可编辑。**

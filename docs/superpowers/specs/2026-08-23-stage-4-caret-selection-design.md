# 阶段 4 光标与文本选区设计

## 背景

阶段 4 已完成确定性文本 layout、headless ProseMirror/IME 编辑状态和对象选择框。下一切片把编辑状态连接到画布交互层：激活文本框后显示光标与文本选区，鼠标命中能产生 ProseMirror 文档位置，并把光标屏幕矩形同步给隐藏 `contenteditable`，使中文 IME 候选框跟随光标。

## 约束

- `@ppt4ai/text` 保持 headless、纯函数和 `structuredClone` 安全；不导入 Vue、DOM、Canvas 或 Element Plus。
- 模型坐标继续使用 EMU。只有 editor host 负责 `EMU -> screen px`，换算为 `emu / 914400 * 96 * zoom` 后叠加画布 viewport 原点。
- ProseMirror 位置使用 UTF-16 文档位置；Enter 仍表示段落拆分，不把换行字符写入正文。
- UI 只使用 Vue 与 UnoCSS；光标和选区绘制在交互层，不创建 DOM 文本镜像。
- 本切片不包含格式化命令、项目符号、竖排、表格、旋转文字和 PPTX 导出。

## 方案

### Headless 文本位置映射

在 `@ppt4ai/text` 增加确定性位置映射模块。输入现有 `TextLayout` 与同一份 ProseMirror `doc`，输出布局坐标中的 caret 矩形、跨行 selection 矩形，并支持布局坐标点命中到文档位置。

映射按段落顺序建立 PM 段落内容起点。每个 layout line 通过其 `paragraphIndex` 和渲染文本与段落文本的顺序匹配得到 UTF-16 范围；run 的宽度按原始 marks 对每个 Unicode code point 重新测量，caret 只落在合法 UTF-16 边界。被自动换行拆开的文本保持连续，空段落得到一条零宽 caret 行。选区按行裁剪，反向选区先规范化为较小位置到较大位置。

### Editor 交互层

在 `@ppt4ai/editor` 增加纯几何的 `text-editor-interaction.ts`，封装 layout 坐标与屏幕像素坐标的转换、caret/selection 的屏幕矩形，以及屏幕点反变换。它不持有编辑状态，也不直接修改 engine。

增加 `TextEditorOverlay.vue` 作为无状态视图：激活时渲染 selection rects、一个 caret 和可选的 composition underline；失活时不渲染编辑层。组件仅使用绝对定位和 UnoCSS，尺寸由 props 明确给出，不用 CSS transform 缩放。

扩展 `TextEditorController` 的同步接口。host 在激活/布局更新/selection 变化后调用 `syncCaret`；controller 将屏幕矩形传给 `ImeInputBridge.setCaretRect`，并在 `focus` 后立即同步一次。controller 仍是单一状态入口，销毁后同步和事件都无效。

### Pointer 命中

编辑 host 将 pointer 屏幕坐标反变换到 EMU，再调用 text 的 hit-test；命中结果通过现有 `dispatch` 产生 `TextSelection`。拖动期间保留 anchor，pointerup 提交 head。边界点使用前一字符/后一字符中更近者，行间距区域命中最近行，框外命中 clamp 到文档首尾。

## 验收

- 单行、多行软换行、显式段落、空段落和段落边界的 caret 坐标稳定。
- 正向和反向跨行选区产生不重叠、按文档顺序排列的矩形。
- 单击每个字符前后能得到对应 PM 位置；点击行间距、文本框外部能 clamp。
- 画布 origin 与 zoom 改变时 caret/selection 和 IME bridge 使用同一屏幕坐标。
- composition provisional 文本仍不写入正文，且光标屏幕矩形持续更新。
- 通过 editor/text 定向测试以及 `pnpm check:boundaries`、`pnpm test`、`pnpm typecheck`、`pnpm build` 和 `git diff --check`。

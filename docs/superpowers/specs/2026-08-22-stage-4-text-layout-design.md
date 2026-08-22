# Stage 4 文本模型与确定性排版设计

## 1. 目标与范围

Stage 4 的第一切片建立可在 Node.js 中运行的 JSON-safe 文本模型和确定性排版核心。它负责把文本元素规范化为 `paragraphs + runs`，按照 EMU 文本框、字符级样式和段落属性生成可供 SceneGraph 消费的行盒。

本切片明确包含：

- `TextBody`、`TextParagraph`、`TextRun` 和 `TextBodyProperties` 数据契约。
- 旧版 `TextElement.text` 字符串到规范文本结构的兼容规范化。
- 确定性字符宽度指标，不依赖 DOM、Canvas 或操作系统字体。
- 显式换行、CJK 逐字换行、拉丁文本优先按词换行以及超长词字符断行。
- 左/中/右对齐、基础缩进、基础行距、段前/段后间距。
- `none`、`shrink`、`resize` 三种基础 Autofit 模式。
- JSON-safe 布局结果和 SceneGraph 文本行盒转换。

本切片明确不包含：

- ProseMirror schema、编辑事务和浏览器编辑桥。
- IME 事件写回；现有 IME bridge/session 契约保持不变，后续切片接入。
- 旋转文本、竖排文本、复杂字体 fallback、OpenType shaping。
- 完整 OOXML field、项目符号渲染、表格文本和 PowerPoint 全量行距语义。
- 依赖 Element Plus 或任何新的组件框架；UnoCSS 仍是唯一 UI 样式框架。

## 2. 分层架构

文本处理保持以下边界：

```text
@ppt4ai/model
  TextBody / TextParagraph / TextRun / TextBodyProperties
          │
          ▼
@ppt4ai/text
  normalize → measure → break lines → autofit → layout
          │
          ▼
@ppt4ai/render
  SceneTextNode.lines（只消费已排版的 JSON 行盒）
```

`@ppt4ai/model` 只声明数据结构和验证规则，不包含字体测量或换行算法。`@ppt4ai/text` 是 headless 纯函数包，不能导入 Vue、访问 DOM 全局或依赖浏览器字体。`@ppt4ai/render` 负责把布局结果装配到 SceneGraph，不重新测量文本。

所有公共值必须能通过 `structuredClone`，所有布局输出必须只包含字符串、数字、布尔值、`null`、数组和普通对象。

## 3. 文本数据模型

### 3.1 字符级 run

```ts
export interface TextRun {
  text: string
  marks?: TextMarks
}

export interface TextMarks {
  fontFamily?: string
  fontSize?: number       // points, positive
  bold?: boolean
  italic?: boolean
  underline?: 'none' | 'single'
  color?: Fill
  baseline?: number       // points, positive or negative
}
```

`TextRun.text` 必须为非空字符串；换行不存储在 run 中，而由 paragraph 边界或显式换行 token 表示。首版将文本内容中的 `\n` 规范化为段落边界，避免同一字符既是正文又是布局控制符。

### 3.2 段落

```ts
export interface TextParagraph {
  runs: TextRun[]
  attrs?: TextParagraphAttrs
}

export interface TextParagraphAttrs {
  align?: 'left' | 'center' | 'right'
  level?: number
  indent?: number       // EMU
  marginLeft?: number   // EMU
  lineSpacing?: number  // percentage, 100000 = single line
  spaceBefore?: number  // EMU
  spaceAfter?: number   // EMU
}
```

`runs` 按文档顺序保存。首版只接受非负 `level`、有限的 EMU 间距和正的行距百分比；未提供的属性使用确定性默认值。

### 3.3 文本框属性

```ts
export interface TextBodyProperties {
  insets?: { left: number; top: number; right: number; bottom: number }
  verticalAlign?: 'top' | 'middle' | 'bottom'
  wrap?: 'square' | 'none'
  autofit?:
    | { type: 'none' }
    | { type: 'shrink'; minFontScale?: number }
    | { type: 'resize'; maxHeight?: number }
}

export interface TextBody {
  bodyPr?: TextBodyProperties
  paragraphs: TextParagraph[]
}
```

默认内边距为 0，默认垂直对齐为 `top`，默认换行为 `square`，默认 Autofit 为 `none`。`minFontScale` 的单位为万分比，默认值为 `60000`；`maxHeight` 为 EMU，缺省时受页面高度限制。

### 3.4 TextElement 兼容策略

现有 `TextElement.text: string` 保留以兼容 Stage 2 导入结果。Stage 4 在不破坏现有调用方的前提下增加可选 `body?: TextBody`：

- 只有 `text`：规范化为一个 paragraph、一个 run。
- 只有 `body`：`body` 是规范来源。
- 同时存在：`body` 优先，`text` 只作为旧消费者的扁平兼容视图；规范化不会从两者合并内容。
- `body` 和 `text` 都不存在，或 `body.paragraphs` 非法：验证失败。

旧字符串中的 `\n` 生成多个 paragraph；空字符串生成一个空 paragraph，布局结果为空行但保持段落高度。

## 4. 确定性测量

布局器不调用 `measureText`，而使用可审计的字符类别指标。每个 run 的基础 advance 由字体大小（points 转 EMU）和字符类别决定：

| 类别 | advance 系数 |
|---|---:|
| CJK、全角标点、Emoji surrogate code point | 1.00 em |
| 大写拉丁字母、数字 | 0.62 em |
| 小写拉丁字母 | 0.54 em |
| 空格 | 0.28 em |
| ASCII 标点 | 0.38 em |
| 其他 BMP 字符 | 0.60 em |

系数是首版稳定契约，不声称等同任何具体字体。`fontFamily` 参与布局输入和缓存键，但不改变首版系数；后续可增加离线字体指标而不改变布局器接口。字号默认 18pt，字号、baseline 和 advance 最终以整数 EMU 计算。

## 5. 换行与行盒

排版可视宽度为：

```text
contentWidth = bounds.w - inset.left - inset.right - paragraph.marginLeft - paragraph.indent
```

当 `wrap === 'none'` 时不自动断行，仅显式段落边界产生新行；当 `wrap === 'square'` 时采用以下顺序：

1. 显式段落边界永远产生新行。
2. CJK/全角字符可在任意字符边界断开。
3. 连续拉丁文本和数字优先以空格分隔的词为候选边界。
4. 单个词超过可视宽度时，按字符断开，保证布局终止。
5. 空格作为词边界参与测量，但行首空格不渲染。

每个行盒至少包含：

```ts
export interface TextLayoutLine {
  paragraphIndex: number
  x: number
  y: number
  width: number
  height: number
  runs: Array<{
    text: string
    x: number
    width: number
    marks?: TextMarks
  }>
}

export interface TextLayout {
  bounds: Rect
  lines: TextLayoutLine[]
  fontScale: number
  overflow: boolean
  contentBounds: Rect
}
```

行高为该行最大字号对应的 `fontSize * lineSpacing`，默认单倍行距；段前/段后加入相邻段落的 y 间距。水平对齐只改变行盒和 run 的 x，不改变测量宽度。垂直对齐在所有行生成后对整体内容 y 做一次偏移。

## 6. Autofit

布局器先按原始字号排版，再根据模式决定是否重排：

- `none`：不改变字号或 bounds；内容超出可用高度时 `overflow: true`。
- `shrink`：使用确定性二分搜索寻找能容纳内容的最大 `fontScale`，范围为 `minFontScale..100000`；保持 bounds 不变。若达到最小比例仍溢出，保留 `overflow: true`。
- `resize`：保持 bounds.x、bounds.y、bounds.w 和字号不变，按内容所需高度扩大 `bounds.h`；若配置 `maxHeight`，不超过该值并在超出时标记 overflow。

`fontScale` 为万分比整数，布局输出中的 run marks 使用原始字号，实际测量通过 `fontScale` 应用；这样编辑器可以区分文档样式和当前 autofit 结果。

## 7. Render 集成

`SceneTextNode` 增加 `layout: TextLayout`，保留现有 `text` 作为兼容字段。`documentToSceneGraph` 对文本元素执行：

1. 解析继承后的 `TextElement`。
2. `normalizeTextElement` 生成 `TextBody`。
3. `layoutText` 生成 `TextLayout`。
4. 将布局结果挂载到 SceneGraph。

渲染层不访问 DOM，不自行测量，也不修改文档模型。旧快照只在兼容字段上保持稳定，新测试断言行盒顺序、run 文本、marks、overflow 和 resize bounds。

## 8. 缓存与错误处理

Stage 4 首版不实现跨元素缓存，但 `layoutText` 必须是纯函数，参数完整包含 bounds、body、默认样式和布局选项，方便下一阶段增加缓存。非法文本模型抛出带路径的 `TextModelError`；布局输入中的负 inset、非正字号、非有限间距和非法 Autofit 参数必须在规范化阶段拒绝。

## 9. 验收标准

- 模型、规范化结果和布局结果均通过 `structuredClone`。
- 旧字符串、新 body 和混合输入有明确且覆盖的测试。
- CJK、英文、混排、显式换行、超长英文词均能自动换行。
- `none`、`shrink`、`resize` 的字号、bounds 和 overflow 断言稳定。
- SceneGraph 输出行盒和 run marks，且无 DOM 依赖。
- `pnpm check:boundaries`、`pnpm test`、`pnpm typecheck`、`pnpm build` 全部通过。
- 阶段完成后更新 `进度.md` 和实施计划，并只创建一次 Stage 4 提交。

## 10. 后续切片

下一切片在本设计之上增加 ProseMirror schema 与 JSON 双向映射，再把现有 `createImeInputBridge` / `reduceImeSession` 接到编辑事务；本阶段不为后续编辑桥预先引入浏览器依赖。

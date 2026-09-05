# 自定义虚线（a:custDash）

> 状态：待实现（2026-09-05）
> 日期：2026-09-05

## 现状

`a:custDash` 完全未建模——导入后 `strokeStyle: undefined`，绘制退化成实线，源包写回**不保留且可能产生非法 XML**。

### 损失验证

**导入**：`packages/pptx-import/src/importer.ts:321` 的 `parseDashStyle` 只读 `a:prstDash/@val`，`a:custDash` 分支不存在。

```xml
<a:ln w="38100">
  <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
  <a:custDash>
    <a:ds d="800000" sp="300000"/>
    <a:ds d="100000" sp="300000"/>
  </a:custDash>
</a:ln>
```

导入后 `element.strokeStyle === undefined`，元素仍可见（有颜色与宽度）但虚线形态丢失。

**源包写回**：`packages/pptx-export/src/writeback.ts:414` 的 `lineDashReplacements` 只认 `prstDash`——当模型设置 `strokeStyle = 'dash'` 时，写回逻辑插入 `<a:prstDash val="dash"/>`，但**不删除源包的 `<a:custDash>`**，结果是两个节点同时存在：

```xml
<a:ln w="38100">
  <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
  <a:prstDash val="dash"/>
  <a:custDash><a:ds d="800000" sp="300000"/><a:ds d="100000" sp="300000"/></a:custDash>
</a:ln>
```

这违反 ECMA-376 Part 1 §20.1.2.2.16 `EG_LineDashProperties` 的互斥规则（`prstDash` 与 `custDash` 二选一）。

### 比较：pattFill 的保留机制

`a:pattFill` 自 `8fe9e56` 起已建模，源包写回靠 `fillNodeNames`（含 `pattFill`）与 `sourceFill` 的 `pattern` 分支配合，把源节点认成"已表达"，因此无关编辑不会重写它。

`a:custDash` **没有对应机制**——`lineDashReplacements` 从不查 `custDash` 是否存在，直接按模型值插入 `prstDash`，两个节点于是并存。

## 契约

让自定义虚线进入模型、影响画布、写回文件，且源包写回时**两种虚线形式互斥保留**。

### @ppt4ai/model

```ts
export interface DashSegment {
  /** `a:ds/@d`：段长度，百分比（100000 = 100%）。 */
  dash: number
  /** `a:ds/@sp`：间距长度，百分比。 */
  space: number
}

export type StrokeDash = StrokeStyle | { custom: DashSegment[] }
```

`ShapeElement` 与 `TextElement` 的 `strokeStyle?: StrokeStyle` 改为 `strokeDash?: StrokeDash`——向后兼容（字符串仍是合法值），且自定义段列表有容身之处。

`validateShapeElement` / `validateTextElement`：

- `strokeDash` 是字符串时，必须是 `strokeStyles` 集合的成员
- `strokeDash` 是对象时，`custom` 必须是数组，每个段的 `dash`/`space` 必须是非负数且 ≤ 100000

`ThemeLineStyle` 同步改为 `dash?: StrokeDash`——主题线条样式条目也能承载自定义虚线（虽然实测很少见）。

### @ppt4ai/pptx-import

`parseDashStyle` 改名为 `parseDash`，返回 `StrokeDash | undefined`：

- 有 `a:prstDash` 时返回其 `val` 属性（现有逻辑）
- 有 `a:custDash` 时返回 `{ custom: [...] }`，每个 `a:ds` 节点映射成 `{ dash: parsePercentage(d), space: parsePercentage(sp) }`
- 两者都无时返回 `undefined`
- 两者**都有**时取 `prstDash`（ECMA 互斥规则下这是非法输入，但导入端不该崩溃——取第一个声明的，与填充的 `parseDirectFill` 一致）

`parseLineStyle` / `parseThemeStyleEntries` 调用处从 `style` 改为 `dash`。

### @ppt4ai/render

`shapeStroke` / `textStroke` 返回值从 `{ style?: StrokeStyle, ... }` 改为 `{ dash?: StrokeDash, ... }`，逻辑不变（元素值 ?? 主题值）。

`SceneShapeNode` / `SceneTextNode` 的 `strokeStyle` 改为 `strokeDash`。

### @ppt4ai/editor

`dashPattern(dash: StrokeDash, width: number): number[]`：

- 输入是字符串时，现有逻辑（四组 switch 分支）
- 输入是 `{ custom }` 时，`custom.flatMap(seg => [seg.dash * width / 100000, seg.space * width / 100000])`

`shape-painting.ts` / `slide-canvas-renderer.ts` / `thumbnail-worker.ts` / `table-painting.ts` 调用 `dashPattern` 的四处从 `node.strokeStyle` 改为 `node.strokeDash`。

### @ppt4ai/pptx-export

#### standalone

`serializeStrokeXml` 新增一个分支：

```ts
const dash = stroke.dash
  ? typeof stroke.dash === 'string'
    ? `<a:prstDash val="${stroke.dash}"/>`
    : `<a:custDash>${stroke.dash.custom.map(seg =>
        `<a:ds d="${seg.dash}" sp="${seg.space}"/>`).join('')}</a:custDash>`
  : ''
```

现有的 `strokeStyle` 条件分支删除（已被 `dash` 分支覆盖）。

#### writeback

`lineDashReplacements` 函数重写，承载两个节点的互斥逻辑：

1. 从源 `<a:ln>` 读出 `prstNode` 与 `custNode`（`line.children.find`）
2. 判定模型想要哪一种：`wanted` 是字符串 → `'preset'`，是对象 → `'custom'`，是 `undefined` → `'none'`
3. 判定源包有哪一种：`source` 是 `'preset'`（有 `prstNode`）/ `'custom'`（有 `custNode`）/ `'none'`（都无）/ `'both'`（非法输入）
4. 四路表：

| source ↓ wanted → | `'none'` | `'preset'` | `'custom'` |
|---|---|---|---|
| `'none'` | 无操作 | 插入 `prstDash` | 插入 `custDash` |
| `'preset'` | 删除 `prstDash` | 替换 `prstDash` | 删除 `prstDash` + 插入 `custDash` |
| `'custom'` | 删除 `custDash` | 插入 `prstDash` + 删除 `custDash` | 替换 `custDash` |
| `'both'` | 删除两者 | 保留 `prstDash` + 删除 `custDash` | 删除 `prstDash` + 保留 `custDash` |

"替换"指比较内容，不同时生成 `Replacement`；"插入"指在填充节点后或 `<a:ln>` 开标签后插入。

现有的 `lineDashReplacements` 逻辑（只认 `prstDash`、比较 `sourceStyle` 与 `wanted`）全部作废。

**注**：描边没有 `sourceFill` 那样的"源侧重建模型值"函数——`lineDashReplacements` 自己从 `XmlElement` 读源值并比较。因此自定义虚线的源侧读取写在这个函数内部（读出 `custNode` 的 `a:ds` 段列表再与模型比较），不需要新的导出函数。这与填充路径的结构不同，是既有代码的分工，本刀不改。

### 测试

`packages/pptx-import/src/custom-dash.test.ts`：

- 读两段自定义虚线：`[{ dash: 800000, space: 300000 }, { dash: 100000, space: 300000 }]`
- 忽略非法段（`d` 或 `sp` 缺失、非数字、负数、超 100000）
- 空 `<a:custDash/>` 不产生 `dash` 键
- `prstDash` 与 `custDash` 同时存在时取 `prstDash`（非法输入容错）

`packages/pptx-export/src/custom-dash.test.ts`：

- standalone 写出 `<a:custDash><a:ds d="800000" sp="300000"/></a:custDash>`
- writeback 保留 `custDash`（无关编辑）
- writeback 将 `custDash` 替换成 `prstDash`（设置 `strokeDash = 'dash'`）
- writeback 将 `prstDash` 替换成 `custDash`（设置 `strokeDash = { custom: [...] }`）
- writeback 清理非法同时存在的两个节点（源包 `'both'` + 模型任一形式）

`packages/editor/src/shape-painting.test.ts`：

- `dashPattern({ custom: [{ dash: 80000, space: 30000 }] }, 100)` 返回 `[80, 30]`
- 多段虚线展平成一维数组
- 零宽度时返回空数组（避免 canvas `setLineDash([NaN])`）

## 未实现

**绘制保真度**：ECMA-376 Part 1 §20.1.8.19 `ST_PositivePercentage` 说 `d` 与 `sp` 是"相对于线宽的百分比"，但微软文档与 LibreOffice 实测可能有偏差——`d="800000"` 是 8 倍线宽还是 80% 某个基准长度，需要**阅读器核对**（制作测试文件、用 PowerPoint 与 LibreOffice Impress 打开、截图对比）。当前实现按字面百分比 `dash * width / 100000` 绘制，可能与原始应用不完全一致。

**主题条目的自定义虚线**：契约里 `ThemeLineStyle.dash` 已扩展成 `StrokeDash`，但实测主题 `lnStyleLst` 条目极少用 `custDash`（预设词够用）。如果导入时遇到，会建模并保留；如果从未遇到，这条路径就是未验证的。

**编辑器 UI**：没有输入自定义段列表的控件——用户只能通过导入文件获得 `custDash`，或在代码里手工构造。增加 UI 是独立的编辑器功能，不在本刀范围。

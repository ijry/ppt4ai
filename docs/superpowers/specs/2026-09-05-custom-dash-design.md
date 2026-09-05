# 自定义虚线（a:custDash）

> 状态：已实现（2026-09-05）
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

### 决策修正：兄弟联合类型，不重命名字段

设计初稿要把 `strokeStyle?: StrokeStyle` 改名成 `strokeDash?: StrokeDash`。**实现时推翻了这个决定**——改名要动模型两处字段、校验、`ThemeLineStyle.style`、导入五处调用、场景两个节点类型与 `shapeStroke`、绘制四条路径、导出两条路径、engine 命令、工具栏 props，以及每一份引用旧名的测试。而它买到的东西，一个联合类型就能给：

```ts
strokeStyle?: StrokeStyle | { custom: DashSegment[] }
```

判据是「退化值是否有意义」。`Fill` 用 `color` 承载渐变第一停靠点、图案前景色，因为那些退化值本身是对的。同理，一个自定义虚线**就是**虚线，只读 `strokeStyle` 而不认对象形态的消费者本来就该当它是虚线——`dashPattern` 早就把十一个词收敛成四种结构，近似是这条路上既有的做法。互斥逻辑无论哪种建模都得在写回里显式处理，联合类型不比改名少写一行。

因此字段名一律不动，只把类型放宽。

### @ppt4ai/model

`DashSegment` 接口（`dash`/`space`，均为正整数）。

`ShapeElement.strokeStyle`、`TextElement.strokeStyle`、`ThemeLineStyle.style`、`TableBorder.style` 四处类型放宽为 `StrokeStyle | { custom: DashSegment[] }`（表格边框另含 `'none'`）。

`resolveStyleLineStroke` 返回类型同步放宽。

校验：字符串走既有 `strokeStyles` 集合；对象形态要求 `custom` 是数组，每段 `dash`/`space` 是**正整数**。

**没有上界**。初稿写的 `0..100000` 是臆造的——`ST_PositivePercentage` 上界开放，而这两个值是**相对线宽的百分比**，`d="400000"` 就是四倍线宽（预设 `dash` 本身就是 `4 * width`）。第一版实现按 100000 截断，写出的测试立刻把真实文件里的段全丢了，这才发现。

### @ppt4ai/pptx-import

`parseDashStyle` 先读 `a:prstDash`，读不到再读 `a:custDash`，两者都无时**仍返回 `'solid'`**——表格边框一直依赖这个回退值，改成 `undefined` 会连带改掉表格的写回比较，那是本刀范围外的行为变更（8 个既有测试立刻标红，已按此判断回滚）。元素路径各自过滤 `'solid'`，与之前逐字相同。

`parseCustomDash` 逐个读 `a:ds`，缺任一百分比或非数字的段丢弃。

### @ppt4ai/render

`SceneShapeNode.strokeStyle`、`SceneTextNode.strokeStyle`、`shapeStroke` 的参数与返回类型放宽。逻辑一行未改——`element.strokeStyle ?? themeLine?.style` 对两种形态都成立。

### @ppt4ai/editor

`dashPattern` 新增对象分支：`custom.flatMap(seg => [seg.dash * width / 100000, seg.space * width / 100000])`。零宽度返回空数组（canvas 对 `[NaN]` 抛错，而全零数组本就画成实线）。

`borderStyle`（表格）遇对象形态直接放行，不查预设词表。

`PptEditor.vue` 只在 `typeof node.strokeStyle === 'string'` 时把它传给工具栏——下拉框只列预设词，自定义虚线让它保持未选中而不是冒充某个预设。

### @ppt4ai/pptx-export

`serializeDashXml` 一处生成两种形态，`themeLineStyleXml` 与形状序列化共用；`table.ts` 的 `serializeBorder` 同样加分支。

`lineDashReplacements` 重写。**这是本刀真正修掉的 bug**：它原先只找 `prstDash`，源包的 `custDash` 对它不可见，于是设置预设线型时插入 `prstDash` 却把 `custDash` 留在原地——同一个 `a:ln` 里出现了 `EG_LineDashProperties` 的两半，非法 XML。现在两个节点都找，不要的那个删掉。

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

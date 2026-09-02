# 表格单元格文本序列化收敛设计

> 状态：待实现（2026-09-02）
> 日期：2026-09-02

## 1. 目标

让表格单元格里的文字走与 shape/text 相同的序列化路径，并修掉 `spAutoFit` 的属性错误。

## 2. 探针结果（实测）

`table.ts` 有第二份文本序列化器，与 `standalone-xml.ts` 的那份并存但功能不全：

| 输入 | `table.ts` 输出 | `standalone-xml.ts` 输出 |
|---|---|---|
| `align: 'left'` | `algn="left"` ❌ | `algn="l"` |
| `align: 'right'` | `algn="right"` ❌ | `algn="r"` |
| `align: 'center'` | `algn="ctr"` ✅ | `algn="ctr"` |
| `lineSpacing`/`spaceBefore`/`spaceAfter` | 全部丢弃，连 `<a:pPr>` 都不生成 | `lnSpc`/`spcBef`/`spcAft` |
| `bullet` | 丢弃 | `buChar`/`buAutoNum` |
| run 文本含 `\n` | 原样写进 `<a:t>` | 切开并插 `<a:br/>` |
| 首尾空格 | 无 `xml:space` | `xml:space="preserve"` |

**对齐那条不是"不够好"，是读不回来**：往返测试确认 `algn="left"` 重新导入后 `attrs` 是 `undefined` —— 因为导入端（与 shape 共用）只认 `l`/`ctr`/`r`。**因此上两个切片打通的格式往返，在表格单元格里是半通的**：导入端读全了段落属性，写出去时被丢掉一半。

`spAutoFit` 的错误在**两份序列化器里都存在**（`table.ts:97`、`standalone-xml.ts:241`）：把 `maxHeight` 写进 `lnSpcReduction`。按 ECMA-376，`spAutoFit` 无属性，`lnSpcReduction` 属于 `normAutofit`，因此该值被任何读者忽略、永不往返。

## 3. 关键决策

**决策 1：把共享的文本序列化提到新文件 `text-xml.ts`，而不是让 `table.ts` 导入 `standalone-xml.ts`**

当前模块方向是 `standalone-xml.ts` → `table.ts`（`:17` 导入 `serializeTableXml`）。让 `table.ts` 反向导入会**成环**。

因此新建 `text-xml.ts`，把 `escapeXml`/`attrs`/`booleanAttribute`/`serializeColorXml`/`serializeFillXml` 与整套文本序列化（marks、bullet、段落属性、body 属性、autofit、run、段落、txBody）搬进去，两份消费者都从它导入。方向变为 `standalone-xml.ts` → `table.ts` → `text-xml.ts`，无环。

**否决了「把表格序列化搬进 `standalone-xml.ts`」** —— 那会让一个已有 380 行的文件再长 200 行，且表格与"无源包生成"是两个关注点。

**决策 2：`txBody` 的标签前缀参数化，沿用 `serializeColorXml(color, prefix)` 的既有手法**

形状要 `<p:txBody>`，表格要 `<a:txBody>`。`serializeTextBodyXml(body, prefix = 'p:')` 加一个默认参数，`standalone-xml.ts` 的调用点不变，表格传 `'a:'`。

**注意只有外层 `txBody` 标签需要前缀** —— 内部的 `a:bodyPr`/`a:p`/`a:r` 在两种上下文里都是 `a:`，这与 `serializeColorXml` 里前缀贯穿所有子元素的情形不同。因此参数只作用于最外层，注释写明。

**决策 3：表格单元格加上 `<a:lstStyle/>`，接受这处输出变化**

`serializeTextBodyXml` 在 `bodyPr` 后写 `<a:lstStyle/>`（形状路径既有行为），而 `table.ts` 的版本没有。收敛后表格输出会多这一个空元素。

**这是合法且无害的** —— `a:lstStyle` 是 `CT_TextBody` 的可选子元素，空元素表示"无覆盖"。`table.test.ts` 的逐字断言需要更新，会在提交信息里说明是有意变化。

**否决了「给 `serializeTextBodyXml` 加 `includeListStyle` 开关」** —— 为了让两条路径输出不同而加参数，正是当初分叉的成因。宁可统一。

**决策 4：`spAutoFit` 写成无属性空元素，`maxHeight` 不再写出**

```ts
if (autofit.type === 'resize') return '<a:spAutoFit/>'
```

**`maxHeight` 字段保留在模型里** —— `layout.ts:483` 用它给 resize 高度设上限，是本项目自选的排版语义，有测试覆盖。它只是**不可持久化**：写不出、读不回。

**否决了「把 `maxHeight` 写成 `normAutofit@lnSpcReduction`」** —— 那会把"扩展形状高度"的语义换成"压缩行距"，两者不是一回事。

**否决了「从模型删掉 `maxHeight`」** —— 排版层在用，删它要连带改 `layoutText` 的 resize 分支与其测试，属独立切片。本切片只让导出不再产生无效属性。

已知代价：带 `maxHeight` 的文档导出再导入后，该字段消失（其余 autofit 语义保持 `resize`）。这一点由测试固定。

## 4. 契约（增量）

新文件 `text-xml.ts` 导出：

```ts
export function escapeXml(value: string | number): string
export function attrs(values: readonly XmlAttribute[]): string
export function booleanAttribute(value: boolean | undefined): string | undefined
export function serializeColorXml(color: Color, prefix?: string): string
export function serializeFillXml(fill: Fill | undefined): string
export function serializeTextBodyXml(body: TextBody, prefix?: string): string
```

`standalone-xml.ts` 继续 re-export `serializeColorXml`/`serializeFillXml`/`serializeTextBodyXml`，因此 `writeback.ts`、`theme-writeback.ts`、`master-layout-writeback.ts` 与 `index.ts` 的导入**一行都不用改**。

`table.ts` 删掉 7 个重复函数（`escapeXml`、`attrs`、`booleanAttribute`、`serializeColor`、`serializeFill`、`serializeBodyProperties`、`serializeAutofit`、`serializeMarks`、`serializeParagraph`、`serializeTextBody`），改为从 `text-xml.ts` 导入。

## 5. 测试策略

- **对齐往返**：`left`/`center`/`right` 三值经 `createPptx` → `importPptx` 后逐字保持（当前 `left`/`right` 失败）
- **段落属性往返**：行距、段前后距、项目符号在单元格里往返
- **换行**：单元格 run 内的 `\n` 变成 `<a:br/>` 并读回同一位置
- **空格**：首尾空格加 `xml:space="preserve"` 并读回
- **两条路径输出一致**：同一个 `TextBody` 经形状路径与表格路径序列化，除最外层 `txBody` 前缀外逐字相同
- **`spAutoFit`**：输出无属性；带 `maxHeight` 的文档往返后 `autofit` 仍是 `resize` 但无 `maxHeight`
- **既有逐字断言更新**：`table.test.ts` 的完整 XML 断言加入 `<a:lstStyle/>` 与修正后的 `algn`

## 6. 已知限制

- `maxHeight` 不可持久化（决策 4）
- `a:defRPr` 继承链仍未做
- 主题字体方案仍是硬编码 Aptos

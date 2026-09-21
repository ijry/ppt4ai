# 文本格式导入设计

> 状态：✅ 已实现（2026-09-02，提交 5bb9e94、3a86c07、2c78838、a464f96）
> 日期：2026-09-02

## 1. 目标

让 `a:rPr`、`a:pPr`、`a:bodyPr` 在导入时进入模型。这三者今天被**完全丢弃**，导致「打开一份排过版的 PPTX，改一个字，所有格式消失」。

## 2. 探针结果（实测，非推断）

动手前写探针确认，而非读码猜测：

| 输入 | 导入结果 |
|---|---|
| `<a:rPr sz="3200" b="1" i="1" u="sng" baseline="30000">` + `srgbClr FF0000` + `<a:latin typeface="Georgia"/>` | `{"text":"Styled"}` —— 无 `marks` |
| `<a:pPr algn="ctr" lvl="2" marL="457200" indent="-228600">` + `lnSpc`/`spcBef`/`spcAft` | `attrs: undefined` |
| `<a:bodyPr lIns=… tIns=… anchor="ctr" wrap="none">` + `<a:normAutofit fontScale="80000"/>` | `bodyPr: undefined`（只有 `vert` 被读） |
| `<a:r>Above</a:r><a:br/><a:r>Below</a:r>` | `text: "AboveBelow\n"`，`body` 里两个 run 相邻、换行消失 |

**关键点是其余各层早已就绪**，只有导入端从不读：

- **模型**：`TextMarks`（`fontFamily`/`fontSize`/`bold`/`italic`/`underline`/`color`/`baseline`）、`TextParagraphAttrs`（`align`/`level`/`indent`/`marginLeft`/`lineSpacing`/`spaceBefore`/`spaceAfter`/`bullet`）、`TextBodyProperties`（`insets`/`verticalAlign`/`vertical`/`wrap`/`autofit`）三者齐全且有 `validateTextBody` 校验。
- **排版**：`layout.ts` 消费对齐（`positionLine:249`）、行距（`:176`）、段前后距（`:348,408`）、insets 与垂直对齐（`:324,362`）、`marginLeft`/`indent`（`:401`）、三种 autofit（`:455`）；`measure.ts` 按 `fontSize` 算宽。
- **绘制**：`text-painting.ts:46` 从 marks 拼出 canvas `font`（含 italic/bold/family/size），`:110` 画单下划线；`scenegraph.ts:119` 解析 `run.marks.color`。
- **导出**：`standalone-xml.ts` 的 `serializeMarks`、`serializeParagraphProperties`、`serializeBodyProperties` 把三者全部写回。

## 3. 两个由此产生的真实故障

**故障一：编辑格式化文本会摧毁其格式。** 探针确认 —— 不动文本时写回逐字节保留源 `rPr`（走 byte-roundtrip 或范围写回的未建模内容保留）；改一个字符后重新序列化 body，输出成了裸 `<a:r><a:t>Edited</a:t></a:r>`，Georgia、字号、颜色全丢。**根因不在写回，而在模型从未捕获这些值**。

**故障二：只改 marks 的编辑被静默忽略。** `writeback.ts:926` 用 `textBodyContent(body) !== source.sourceText` 判断是否重写 `txBody`，比较的是**纯文本内容**。因此把 `marks: { bold: true }` 加到一个未改字符的 run 上，不产生任何 replacement。这条在本切片修完导入后才可能被正确修复 —— 否则「保留源格式」与「写回新格式」无法区分。

## 4. 范围

**做**：

1. `parseRunMarks(rPr)` —— 读 `sz`/`b`/`i`/`u`/`baseline`、`a:solidFill`、`a:latin@typeface`
2. `a:br` 保位 —— 变为 run 文本内的 `\n`，而非末尾计数
3. `parseParagraphAttrs(pPr)` —— `algn`/`lvl`/`marL`/`indent` + `lnSpc`/`spcBef`/`spcAft` 子元素
4. `parseBodyProperties(bodyPr)` —— 四个 inset、`anchor`、`wrap`、三种 autofit
5. 模型放宽 `indent` 校验为带符号

**不做**（明确延期，并说明理由）：

- **`a:defRPr` 段落级默认继承** —— 探针确认它也被丢弃，但正确实现需要一条 `defRPr → lstStyle → placeholder → master txStyles` 的继承链，是独立切片。本切片只读 run 自己的 `rPr`。
- **修复故障二（marks-only 编辑写回）** —— 需要把 `sourceTextContent` 的比较从纯文本扩展到含格式，或改判断策略。导入先落地才有意义，否则无从比较。
- **字体/格式方案（`a:fontScheme`/`fmtScheme`）** —— `serializeThemeXml` 里是硬编码的 Aptos，主题字体不在模型中。与本切片同属"文字"但层次不同（主题级 vs run 级）。
- **`+mj-lt`/`+mn-lt` 主题字体引用解析** —— 依赖上一条。

## 5. 关键决策

**决策 1：`a:br` 转成 run 内的 `\n`，与导出侧既有约定对齐**

导出侧 `serializeRun`（`standalone-xml.ts:321`）已经把 run 文本按 `\n` 切开、中间插 `<a:br/>`。导入按同一约定反向做即可，模型无需新增"break run"类型。

当前 `parseText` 与 `parseTextBody` 都用「数 `a:br` 个数、在末尾补等量 `\n`」，这在只有一个 run 时凑巧正确，多 run 时位置就错。改为遍历段落子节点，遇 `a:br` 就往「待拼接文本」里加 `\n`。

**注意 `writeback.ts` 的 `sourceTextContent` 与 `textBodyContent` 用的是同一套"末尾计数"算法**，两边一致所以比较结果正确。本切片**不改它们** —— 那对函数只需内部自洽，而修改会牵动整个写回的相等性判断。这是有意的不一致，会写进注释。

**决策 2：`u="none"` 落成 `underline: 'none'` 而非省略字段**

模型的 `underline` 是 `'none' | 'single'` 两值枚举，`'none'` 是合法值。`u="none"` 是显式关闭（可覆盖继承来的下划线），与属性缺失语义不同，因此保留区分。这与翻转切片「`flipH="0"` 与缺失等价」相反 —— 那里模型只有 `true | undefined`，没有第三态可表达。

**决策 3：`indent` 校验放宽为带符号，`marginLeft` 等保持非负**

`validateTextParagraph` 现在把 `indent`/`marginLeft`/`spaceBefore`/`spaceAfter` 一并要求 `>= 0`。**但 OOXML 悬挂缩进本就是负值** —— `marL="457200" indent="-228600"` 是标准项目符号写法（首行左移、其余右缩）。因此 `indent` 单独放宽为任意有限数，另三个保持非负。

**注意 `layout.ts:403` 用 `insets.left + marginLeft + indent` 算基线 x，负 indent 天然正确；但 `:339` 的竖排路径用 `availableHeight - marginTop - indent`，负值会让可用高度变大。** 竖排 + 悬挂缩进的组合本就未被测试覆盖，本切片不改竖排数学，只在测试里固定"负 indent 能导入并往返"，竖排交互留待有真实用例时处理。

**决策 4：`spcPct` 用 `val` 原值，`spcPts` 换算成 EMU**

`lnSpc/spcPct@val` 是十万分之一比例，模型的 `lineSpacing` 同单位，直接取值。`spcBef/spcPts@val` 是百分之一磅，模型的 `spaceBefore` 是 EMU —— 导出侧 `toPointHundredths` 用 `/127`（1 pt = 12700 EMU，百分之一磅 = 127 EMU），导入按 `*127` 反向。

只支持 `spcPct` 形式的行距、`spcPts` 形式的段间距，与导出侧能写出的形态一一对应。遇到 `lnSpc/spcPts` 或 `spcBef/spcPct` 时**跳过而非猜测**，避免单位错位。

**决策 5：`spAutoFit` 不读 `lnSpcReduction`**

模型的 `{ type: 'resize'; maxHeight?: number }` 里 `maxHeight` 是 EMU 高度上限，而导出侧 `serializeAutofit` 把它写成了 `<a:spAutoFit lnSpcReduction="…"/>`。**按 ECMA-376，`lnSpcReduction` 属于 `normAutofit`，`spAutoFit` 没有属性** —— 导出侧那行是错的，但修它会改变既有 standalone 输出的字节，属独立切片。

本切片导入侧只把 `<a:spAutoFit/>` 读成 `{ type: 'resize' }`（不带 `maxHeight`），`<a:normAutofit fontScale="…"/>` 读成 `{ type: 'shrink', minFontScale }`，`<a:noAutofit/>` 读成 `{ type: 'none' }`。**在设计文档里记下导出侧的这处错误**，不在本切片顺手改。

## 6. 契约（增量）

导入侧新增四个内部函数，**不改任何公开签名**：

```ts
function parseRunMarks(runProperties: XmlNode | undefined): TextMarks | undefined
function parseParagraphAttrs(paragraphProperties: XmlNode | undefined): TextParagraphAttrs | undefined
function parseBodyProperties(bodyProperties: XmlNode | undefined): TextBodyProperties | undefined
```

`parseParagraphAttrs` 吸收既有的 `parseBullet`（bullet 成为它返回对象的一个字段），调用点从两处收敛到一处。

模型侧一处放宽：

```ts
// 之前：indent 与 marginLeft/spaceBefore/spaceAfter 一同要求 >= 0
if ('indent' in attrs) validateFiniteNumber(attrs.indent, `${path}.attrs.indent`, errors, () => true, 'must be finite')
```

## 7. 测试策略

先写测试再实现：

- **import 单元**：七类 marks 各自导入；`u="none"` 与缺失可区分；`b="0"` 落 `false` 而非省略（与 `parseStyleText` 既有约定一致）；段落四属性 + 三个子元素；`indent` 负值；四个 inset、`anchor` 三值、`wrap`、三种 autofit；bullet 仍从 `parseParagraphAttrs` 出来
- **br 保位**：`Above<br/>Below` 在 body 里成为含 `\n` 的一个 run 或两个 run 加 `\n`，且 `element.text` 的换行位置正确
- **往返**：import → standalone export → import，marks 与段落属性逐字保持
- **写回不回归**：既有 `sourceTextContent` 比较不受影响（未编辑的格式化文本仍走 byte-roundtrip）
- **model**：负 `indent` 通过校验，负 `marginLeft` 仍被拒

## 8. 已知限制

- `a:defRPr` 继承链未做（见范围）
- 只改 marks 不改字符的编辑仍不写回（故障二，待独立切片）
- 主题字体方案仍是硬编码 Aptos
- `serializeAutofit` 把 `maxHeight` 写成 `spAutoFit@lnSpcReduction`，与 ECMA-376 不符（本切片只记录，不修）
- 竖排文本 + 负 `indent` 的组合数学未验证

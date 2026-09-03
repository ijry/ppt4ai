# 文本格式写回设计

> 状态：✅ 已实现（2026-09-02，提交 c555c4a）
> 日期：2026-09-02

## 1. 目标

让「只改格式、不改字符」的编辑能写回源包。

上一切片（`5bb9e94`…`a464f96`）把 `a:rPr`/`a:pPr`/`a:bodyPr` 接进了导入端，因此**改文字时格式已能正确带出** —— 那条断言直接通过。本切片补上剩下的一种形状。

## 2. 探针结果

六条测试，三通过三失败，失败的三条形状一致：

| 编辑 | 结果 |
|---|---|
| 改文字 + 保留 marks | ✅ 写回，Georgia/32pt/居中全在 |
| 未编辑 | ✅ 字节完全相同 |
| 只改 bounds | ✅ 源 `rPr` 逐字保留，不重写 `txBody` |
| **只改字体**（`Georgia` → `Verdana`） | ❌ 输出仍是 `Georgia` |
| **只改对齐**（`ctr` → `r`） | ❌ 输出仍是 `algn="ctr"` |
| **清空 marks** | ❌ 输出仍带 `Georgia` |

## 3. 根因

`writeback.ts:926`：

```ts
if (source.sourceText !== undefined && textBodyContent(body) !== source.sourceText) {
  replacements.push({ start: sourceTextBody.start, end: sourceTextBody.end, value: serializeTextBodyXml(body) })
}
```

`sourceTextContent`（`:119`）与 `textBodyContent`（`:133`）都产出「拼接所有 `a:t` 文本、末尾补 `a:br` 个数个 `\n`」的**纯文本摘要**。格式不在摘要里，所以格式变化对这个判断完全不可见。

**两边算法一致，所以此前的比较结果是正确的** —— 它准确回答了「文字内容变了吗」，只是那不是我们现在需要的问题。

## 4. 关键决策

**决策 1：把比较从纯文本升级为结构比较，判据是「序列化后是否相同」**

新增 `sourceTextBody(element: XmlElement): TextBody | undefined`，从源 XML 解析出完整 `TextBody`（marks、段落属性、body 属性），然后：

```ts
const sourceBody = sourceTextBody(sourceElement)
if (sourceBody === undefined || serializeTextBodyXml(body) !== serializeTextBodyXml(sourceBody)) {
  // 重写
}
```

**两边都过同一个 `serializeTextBodyXml`**，因此字段顺序、属性顺序、省略规则全部由构造归一化，不需要写深比较，也不需要 canonical JSON。而且这个判据的语义恰好就是我们要问的问题：「按模型写出来的 XML，和源文件表达的意思，是否不同」。

**否决了「直接把 `serializeTextBodyXml(body)` 与源 `txBody` 原文比较」** —— 源文件的格式化、属性顺序、命名空间前缀几乎不可能与我们的序列化器逐字相同，那会让每次导出都重写每个 `txBody`，摧毁未建模内容。必须先解析成模型再序列化，让两边走同一条归一化路径。

**决策 2：镜像导入端的解析，而不是共享一份实现**

`sourceTextBody` 及其三个子函数是导入端 `parseTextBody`/`parseRunMarks`/`parseParagraphAttrs`/`parseBodyProperties` 的镜像。

**这是本文件的既有约定，不是新发明** —— `writeback.ts` 已经用同样的方式镜像了四处：`sourceColor` ↔ `parseColor`、`sourceBounds` ↔ `parseBounds`、`sourceRotation` ↔ `parseRotation`、`flipAttribute` ↔ `parseFlips`。

**原因是两个 XML 表示按设计不同**：导出端的 `XmlElement` 带 `start`/`end` 字节偏移（范围写回必需），导入端的 `XmlNode` 不带；导入端用 `localName(name)` 函数剥前缀，导出端 `XmlElement` 直接有 `localName` 字段。

**否决了「让 pptx-export 真依赖 pptx-import 并共享解析」**：需要把 `XmlNode` 也加上 `localName` 字段、把解析函数泛型化到一个公共最小接口、并把 export 对 import 的 devDependency 升为运行时依赖 —— 那会把「导出依赖导入」这条方向固化进架构，代价远超本切片。若将来镜像对数量继续增长，那是一个独立的收敛切片，届时应连同已有四对一起做。

**决策 3：删掉 `sourceTextContent` 与 `textBodyContent`，不保留**

两者唯一的调用点就是 `:926`。替换后即成死代码，直接删除而非留着「以防万一」。

**决策 4：源包无法解析成 body 时按「已改变」处理**

`sourceTextBody` 返回 `undefined` 只在没有 `txBody` 时发生，而该分支的前提正是 `sourceTextBody` 存在（`:923`）。因此实际不会走到；仍写成保守分支（重写）而非跳过，因为「不确定」时保留模型意图比保留源字节更符合本函数的职责。

## 5. 契约（增量）

无公开签名变化。写回内部新增：

```ts
function sourceRunMarks(runProperties: XmlElement | undefined): TextMarks | undefined
function sourceParagraphAttrs(paragraphProperties: XmlElement | undefined): TextParagraphAttrs | undefined
function sourceBodyProperties(bodyProperties: XmlElement | undefined): TextBodyProperties | undefined
function sourceTextBody(element: XmlElement): TextBody | undefined
```

`ScannedElement.sourceText: string` 变为 `sourceBody: TextBody`，扫描阶段一次解析、比较阶段复用。

## 6. 测试策略

已先写好 6 条（`text-formatting-writeback.test.ts`），三条当前失败的正是本切片的验收：

- 只改字体 → 输出含 `Verdana`，重新导入得到 `{ fontFamily: 'Verdana' }`
- 只改对齐 → 输出含 `algn="r"`
- 清空 marks → 输出不含 `Georgia`（清空是真编辑，不是 no-op）
- 改文字 + 保留 marks → 三项格式与对齐都在（已通过，防回归）
- 未编辑 → 字节完全相同（已通过，防回归 —— 这条最关键，结构比较若有偏差会立刻在这里炸）
- 只改 bounds → 源 `rPr` 逐字保留（已通过，防回归）

## 7. 已知限制

- `a:defRPr` 继承链仍未做，因此源文件里靠 `defRPr` 表达的格式在模型中不可见，比较时会被当作「无格式」；若用户不碰该元素，`serializeTextBodyXml` 两边都不含它、比较相等、不重写，故**不会造成丢失**；一旦用户编辑该元素，`defRPr` 会随整个 `txBody` 被替换掉 —— 这是导入缺口的下游后果，非本切片新增
- `serializeAutofit` 的 `spAutoFit@lnSpcReduction` 错误仍在（见上一份设计文档）
- 主题字体方案仍是硬编码 Aptos

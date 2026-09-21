# Run 级中日韩字体设计

> 状态：已实现（2026-09-03，`377c631`）
> 日期：2026-09-03

## 1. 目标

让一个 run 能同时带西文与中日韩字体（`<a:latin>` + `<a:ea>`），并让画布按字符所属文字系统选用对应字体。这是 2026-09-03 主题字体三个切片一直点名延期的那项。

## 2. 探针结果（实测）

一个 run 带 `<a:latin typeface="Calibri"/><a:ea typeface="宋体"/><a:cs typeface="Arial"/>`，文字是 `Hello 你好`；另一个 run 用主题引用 `+mn-lt` / `+mn-ea`：

```
MIXED MARKS:  {"fontFamily":"Calibri","fontSize":24}
THEMED MARKS: {"fontFamily":"+mn-lt"}
```

**`<a:ea>` 与 `<a:cs>` 都被丢掉**。后果有两面：

1. **画布字形错**：`Hello 你好` 整段用 Calibri 渲染，而 PowerPoint 会给「你好」用宋体。中文文档几乎每个 run 都是这个形状，所以这是中文 PPT 的普遍现象而非边角。
2. **编辑即丢**：未编辑时两边序列化都不含 `a:ea`、比较相等、不重写，所以文件层面不丢；**一旦编辑该元素**，整个 `txBody` 被 `serializeTextBodyXml` 重写，而它只写 `<a:latin>` —— EA 字体就此从文件里消失。

**顺带查出一个先于本切片的真 bug**：`packages/text/src/editor/model.ts:10` 的 `paragraphAttrNames` 白名单里**没有 `defaultMarks`**，而 `TextParagraphAttrs.defaultMarks` 是上一个分级默认切片新增的字段。就地编辑任何段落都会经 ProseMirror 往返，于是 `a:pPr/a:defRPr` 被静默丢弃。同一层的同类问题，本切片一并修掉。

**运气好的一面**：`pptText` mark 把整个 `marks` 对象作为一个不透明 attr 存（`schema.ts:26`），所以 `TextMarks` 新增字段自动跟着往返，不需要改 schema 的 mark 部分。段落 attrs 是逐字段列举的，所以才有上面那个洞。

## 3. 关键决策

**决策 1：平铺 `fontFamilyEa` / `fontFamilyCs`，`fontFamily` 保持「西文槽位」语义**

```ts
export interface TextMarks {
  fontFamily?: string      // a:latin —— 既有字段，语义不变
  fontFamilyEa?: string    // a:ea
  fontFamilyCs?: string    // a:cs
  …
}
```

**否决了嵌套 `fontFamilies: { latin, ea, cs }`**：那要改动既有 `fontFamily` 的每个消费者（排版、绘制、导出、工具栏、`formatting.ts` 的 mark 白名单、`TextFormattingState`），而 `parseRunMarks` 本来就是只读 `<a:latin>` 填 `fontFamily`，平铺是纯加法。

**决策 2：按字符分流发生在 `packages/text` 排版层，主题解析仍在场景图**

排版层**已经逐字符分词**（`paragraphTokens` 给每个字符建一个 token 并带 `cjk` 标记），只是 `createRuns` 随后按 marks 相等把相邻 token 合并回 run，把这个区分丢掉了。所以改动很小：token 带上 `script`，合并条件加一项。

分工由此变成三段，每段都留在自己的边界内：

| 层 | 职责 | 新增 |
|---|---|---|
| `packages/text` | 判定每个字符属于哪套文字系统，按此切分 run | `TextLayoutRun.script?: 'ea'` |
| `packages/render` | 把 `script` + marks 解析成具体字体名（含 `+mn-ea` 主题引用） | 复用既有 `resolvedFontFamily` 字段 |
| `packages/editor` | 绘制 | **一行都不用改** —— 已经优先读 `resolvedFontFamily` |

排版层不需要知道主题，绘制层不需要知道文字系统。**主题字体切片建立的 `resolvedFontFamily` 兄弟字段与 `+` 前缀兜底在这里直接复用**，`resolveThemeFontFamily` 认得 `+mj-ea`/`+mn-ea` 那两个 token（当时就一并实现了，只是导入端产生不出来）。

**决策 3：只在 run 真的带 EA 字体时才分流，否则合并行为逐字不变**

若无条件按 CJK 切分，任何中英混排文本的 run 数都会变多，既有排版断言与光标映射断言会大面积变动。因此 `script` 只在 `marks.fontFamilyEa` 存在时才可能出现 —— 不带 EA 字体的文本（绝大多数）排版输出逐字不变。这与主题字体切片「`resolvedFontFamily` 只在解析改变了字体名时才挂」是同一条纪律。

**决策 4：`cs`（复杂文字）只存不选**

字符→文字系统的判定复用既有的 `isCjkOrFullWidth`，它只区分「中日韩/全角」与「其他」。阿拉伯/希伯来/泰文/天城文的范围判定要新写一套分类表，且本项目当前没有这些语言的测试素材，猜范围不如不做。`fontFamilyCs` 因此**能导入、能写回、能往返，但永远不会被画布选中** —— 写进已知限制。

**决策 5：写回两侧同时改，与解析对称**

`text-xml.ts` 输出 `<a:ea>`/`<a:cs>`（仅在有值时），`text-source.ts` 的 `sourceTextBody` 同步读它们。两侧不对称会让「源与模型的 EA 字体相同」被判成不等，导致未编辑的文本被无谓重写 —— 这条判据是文本格式写回切片定下的，此处照办。

**决策 6：工具栏不加控件**

`formatting.ts` 的 `markNames` 白名单不加这两项，因此 `setTextMarks` 仍拒绝它们。中日韩字体的 UI（以及它与主题 `ea` 槽位的关系）是独立切片；本切片只做「导入能读、画布能选、导出能写」。

## 4. 契约（增量）

`TextMarks` 新增两个可选字符串字段，进 `validateDocument`（非空字符串）。

`@ppt4ai/text` 的 `TextLayoutRun` 与 `TextLayoutMarker` 新增可选 `script?: 'ea'`。

`packages/text/src/editor/model.ts` 的 `paragraphAttrNames` 补 `defaultMarks`，`schema.ts` 的 paragraph attrs 同步补 `defaultMarks: { default: null }`（修既有 bug）。

无签名破坏。

## 5. 测试策略

- **导入**：`<a:ea>`/`<a:cs>` 进 `fontFamilyEa`/`fontFamilyCs`；空 `typeface` 不进模型；只有 `<a:latin>` 时另两项不出现
- **排版**：带 EA 字体的混排文本按文字系统切成多个 run 且 `script` 正确；不带 EA 字体时 run 数与文本逐字不变（防回归）
- **场景**：`ea` run 解析成 `fontFamilyEa`；`+mn-ea` 经主题解析成真实字体名；EA 与 latin 相同时不挂 `resolvedFontFamily`
- **绘制**：混排文本的两段各用自己的字体串（验证 `resolvedFontFamily` 一路到 `context.font`）
- **往返**：导入→导出→重新导入三个字体名一致；未编辑时源 `<a:ea>` 逐字保留
- **就地编辑**：段落带 `defaultMarks`、run 带 `fontFamilyEa` 时，经 ProseMirror 往返两者都还在（修 bug 的回归钉子）

## 6. 已知限制

- `cs` 只存不选（决策 4），复杂文字仍按西文字体渲染
- 工具栏无中日韩字体控件（决策 6）
- `<a:font script="Hans" typeface="…">` 按脚本回退表仍不建模
- `measureText` 不看字体名，所以中日韩字体只改字形不改字宽（这一条与主题字体切片相同）
- `<a:sym>`（符号字体）仍不读

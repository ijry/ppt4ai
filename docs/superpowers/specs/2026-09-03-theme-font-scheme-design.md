# 主题字体方案设计

> 状态：待实现（2026-09-03）
> 日期：2026-09-03

## 1. 目标

让主题的 `a:fontScheme` 进入模型，并让 `+mj-lt` / `+mn-lt` 这类**主题字体引用**在渲染时解析成真实字体名。

## 2. 探针结果（实测）

构造一个带完整 `fontScheme` 的主题（major：Cambria / 宋体，minor：Calibri / 等线），并让幻灯片标题的 run 用 `<a:latin typeface="+mj-lt"/>`：

```
THEME: {"id":"theme_1","colors":{"dk1":{"type":"srgb","v":"000000"}},"source":{"partPath":"ppt/theme/theme1.xml"}}
RUN MARKS: {"fontFamily":"+mj-lt"}
```

两处都坏：

1. **`Theme` 没有 `fonts` 字段，`parseTheme` 只读 `clrScheme`** —— Cambria / Calibri / 宋体 / 等线 四个字体名一个都没进模型。
2. **`+mj-lt` 被当字面字体名存进 `marks.fontFamily`** —— 一路走到 `text-painting.ts:50` 的 `JSON.stringify(marks?.fontFamily ?? DEFAULT_FONT_FAMILY)`，画布上的 `context.font` 变成 `18px "+mj-lt"`。没有任何已装字体叫这个名字，浏览器回退到自己的默认字形，与 PowerPoint 不一致。**真实 PPTX 的占位符几乎全用主题引用**，所以这不是边角情形。

第三处在导出端：`standalone-xml.ts:116` 的 `serializeThemeXml` 把 `fontScheme` 硬编码成 Aptos Display / Aptos，与模型无关。

## 3. 与前几个切片的关系

主题颜色链路已经完整（`clrScheme` 导入、`resolveColor` 解析、`rewriteThemeXml` 最小差异写回、`setThemeColor` 命令、`ThemePanel` 面板）。**字体是同一条链路上缺的另一半**，本切片按颜色的既有形状补齐读取与解析两端。

关键对称性差异：**颜色引用 `{type:'scheme', v:'accent1'}` 由 `p:clrMap` 逐 master 重映射，字体引用没有任何 map** —— OOXML 没有 `p:fontMap`，`+mj-lt` 直指主题的 majorFont。所以解析函数不吃 `colorMap` 参数。

## 4. 关键决策

**决策 1：模型存 `fonts?: ThemeFonts`，值为 `string | null`，空 `typeface=""` 视为不存在**

```ts
export type ThemeFontSlot = 'major' | 'minor'
export type ThemeFontScript = 'latin' | 'ea' | 'cs'
export type ThemeFontFace = Partial<Record<ThemeFontScript, string | null>>
export type ThemeFonts = Partial<Record<ThemeFontSlot, ThemeFontFace>>
```

`null` 沿用颜色的语义（见 theme-editing-ui 设计决策 3）：显式写入内置默认值，而 `undefined` 是「不建模，保持源部件原样」。

`<a:ea typeface=""/>` 是 Office 主题的常态（表示「东亚字体无覆盖」），模型**不存空串** —— 与 `parseRunMarks` 已有的 `if (typeface)` 一致。代价：模型无法区分「源里没有 `a:ea` 节点」与「源里有但 typeface 为空」，两者都是 `undefined`；写回端因此对这两种情况都不动源节点，语义上正确。

**决策 2：`+mj-lt` 保留在模型里，渲染时才解析，导入时不展开**

与 `{type:'scheme'}` 颜色同构。若导入时就展开成 Cambria，两件事会坏：①`text-xml.ts:110` 把 `marks.fontFamily` 原样写回 `<a:latin typeface>`，展开后文本从「跟随主题」变成「钉死 Cambria」；②后续改主题字体时这些文本不再跟着变。

**决策 3：解析函数 `resolveThemeFontFamily(family, theme)` 放 `packages/model`，识别到引用就一定给出具体字体名**

```ts
export function resolveThemeFontFamily(family: string | undefined, theme?: Theme): string | undefined
```

非引用（不在六个 token 内）原样返回。识别到引用时：模型值 → `DEFAULT_THEME_FONTS` 内置默认值。

**这里刻意不照抄颜色的行为**：`resolveColorSource` 在主题缺槽位时返回 `undefined`（调用方于是不画填充），因为「缺失的颜色」没有普适默认值；而文本永远需要某个字体名，且 `serializeThemeXml` 自己的兜底就是 Aptos，**让渲染与导出用同一套兜底**才不会出现「画布显示 Cambria、导出文件写 Aptos」的分叉。

`DEFAULT_THEME_FONTS` 里 `ea`/`cs` 的默认值是空串（Office 默认主题就是空的），空串→返回 `undefined`。

**决策 4：场景图挂 `resolvedFontFamily` 兄弟字段，不改 `marks`；仅在解析改变了字体名时才挂**

镜像 `resolvedColor` 的约定。`toSceneTextLayout` 已经逐 run 走一遍挂 `resolvedColor`，字体在同一趟里挂。

只在 `resolved !== marks.fontFamily` 时写入，因此**不含主题引用的文本，场景输出逐字节不变**（现有场景断言不受影响），也不给每个 run 复制一份重复字符串。

marker（项目符号）**一并解析** —— `a:buFont typeface="+mj-lt"` 合法且常见，`layout.ts:213` 会把 bullet 的 `fontFamily` 合进 marker 的 marks，不解析就是同一个错字形。为此新增 `SceneTextLayoutMarker`。**注意 marker 的颜色至今仍未解析**（`text-painting.ts:58` 只对 run 取 `resolvedColor`），那是先于本切片存在的独立缺口，不在本切片修。

**决策 5：绘制端把「仍以 `+` 开头」的字体名当作没有字体**

```ts
const requested = resolvedFontFamily ?? marks?.fontFamily
const family = JSON.stringify(requested && !requested.startsWith('+') ? requested : DEFAULT_FONT_FAMILY)
```

OOXML 里 `typeface` 的 `+` 前缀是主题引用的保留写法，没有合法字体名以 `+` 开头。这一行兜住所有解析不出来的引用形式（例如源文件把 `+mj-ea` 写进 `<a:latin>`，而 EA 默认值为空），保证**字面引用永远不会进 `context.font`**。它只影响绘制，不动模型，写回仍原样输出引用。

**决策 6：`serializeThemeXml` 读模型，缺失时兜底 `DEFAULT_THEME_FONTS`**

Aptos 的字面量从函数体里挪进 `DEFAULT_THEME_FONTS`，模型无 `fonts` 时输出与今天逐字节相同。

**决策 7：字体写回（`rewriteThemeXml`）与字体编辑（engine 命令 + 面板）留到下一切片**

本切片只做「读进来 + 解析」。`rewriteThemeXml` 保持只改 `clrScheme`：源部件里的 `fontScheme` 未被任何命令改动过，不重写就是正确行为。

**下一切片必须先做写回再做命令**，否则会重演 a23c694 修的那类问题：模型能改而写回不认，编辑被静默丢弃。已核实 `fingerprintDocument` 走 `canonicalJson(整份文档)`，`fonts` 自动进指纹，所以字体一改就会走写回路径而非 byte-roundtrip —— 丢弃会发生在 `rewriteThemeXml` 内部，不是在导出选路上。写回要按最小差异做，源里的 `panose`/`pitchFamily`/`charset` 属性与 `<a:font script="…"/>` 子节点都不建模，必须原样保留。

**决策 8：`fmtScheme` 继续延期**

样式矩阵（`fillStyleLst`/`lnStyleLst`/`effectStyleLst`/`bgFillStyleLst`）要连带 `<p:style>` 的 `idx` 引用与 `phClr` 代入才有意义，是独立切片。`serializeThemeXml` 里的空 `fmtScheme` 保持原样。

## 5. 契约（增量）

新增导出（`@ppt4ai/model`）：`ThemeFontSlot`、`ThemeFontScript`、`ThemeFontFace`、`ThemeFonts`、`DEFAULT_THEME_FONTS`、`resolveThemeFontFamily`。

`Theme` 新增可选 `fonts`，`validateDocument` 相应校验槽位名、script 名与「非空字符串或 null」。

`@ppt4ai/render` 新增 `SceneTextLayoutMarker`；`SceneTextLayoutRun` 新增可选 `resolvedFontFamily`；`SceneTextLayoutLine.marker` 类型收窄到新类型（对读取方是加法）。

无签名破坏。`text-painting.ts` 的 `fontState`/`paintStyle` 是包内私有函数，签名自由调整。

## 6. 测试策略

- **model**：六个 token 各自解析；未知 token 原样返回；`undefined` 主题、缺 `fonts`、`null` 值均落到内置默认；`ea` 默认空串→`undefined`；大小写与空白容错；校验拒绝非法槽位/script/空串
- **import**：`majorFont`/`minorFont` 的 latin/ea/cs 进 `fonts`；`typeface=""` 不进模型；无 `fontScheme` 不产生 `fonts` 字段；只有字体没有颜色的主题也能导入
- **export standalone**：模型字体进 `theme1.xml`；无 `fonts` 时输出与今天一致（Aptos）；`null` 落到默认；字体名里的引号与 `&` 正确转义
- **render**：`+mj-lt` 的 run 拿到 `resolvedFontFamily`；字面字体名的 run 不产生该字段；marker 同样解析；表格单元格文本同样解析
- **paint**：字体串用解析后的字体名；解析不出的 `+` 引用回退到 `DEFAULT_FONT_FAMILY`
- **回归**：主题往返（导入→导出→重新导入）字体一致；未编辑的 byte-roundtrip 不受影响

## 7. 已知限制

- 主题字体**只能读不能改**：无 engine 命令、无面板 UI、`rewriteThemeXml` 不写 `fontScheme`（决策 7）
- `fmtScheme` 仍不在模型中（决策 8）
- `marks.fontFamily` 只来自 `<a:latin>`，run 级的 `<a:ea>`/`<a:cs>` 仍不建模，因此中英文混排无法各用一套字体
- `<a:font script="Hans" typeface="…"/>` 的按脚本回退表不建模
- marker 的**颜色**仍不解析（决策 4），先于本切片存在
- 工具栏字体框对主题引用的 run 会显示 `+mj-lt` 字面值
- `measureText` 完全不看字体名（只按字号与字符类别估宽），所以本切片不改变任何排版结果，只改变画布字形
- `a:defRPr` 分级默认链仍未做

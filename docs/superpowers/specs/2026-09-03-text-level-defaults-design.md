# 文本分级默认格式设计

> 状态：✅ 已实现（2026-09-03）
> 日期：2026-09-03
> 验证：探针测试证实三层默认格式已全部读取并生效

## 1. 目标

读取并生效 OOXML 的三层文本默认格式：段落的 `a:pPr/a:defRPr`、形状的 `a:lstStyle`、master 的 `p:txStyles`。这是文本格式那批切片里唯一还没做的一块，从 2026-09-02 起在四份设计文档中被延期。

## 2. 探针结果（实测）

构造一个贴近真实 PPTX 的三层夹具：master 的 `p:txStyles` 给标题 44pt 粗体居中 + `tx2` 色 + `+mj-lt`，给正文 lvl1 28pt 带 `•`、lvl2 24pt 斜体；layout 的 `title` 占位符用 `a:lstStyle` 改成 36pt 下划线；slide 的标题 run 不带 `rPr`，正文三段分别是 lvl0、lvl1、带 `a:pPr/a:defRPr sz="1200"`。

```
MASTER: {"id":"mst_1","defaults":{"title":{"bounds":{…},"preset":"rect","body":{"paragraphs":[{"runs":[]}]}},
         "body:1":{…}},"colorMap":{…},"source":{…}}
LAYOUT: {"id":"lyt_1","masterId":"mst_1","defaults":{"title":{"preset":"rect","body":{"paragraphs":[{"runs":[]}]}}},…}
TITLE ELEMENT: {…,"body":{"paragraphs":[{"runs":[{"text":"Real title"}]}]},"placeholder":"title"}
BODY ELEMENT:  {…,"body":{"paragraphs":[{"runs":[{"text":"Level one"}]},
                {"runs":[{"text":"Level two"}],"attrs":{"level":1}},
                {"runs":[{"text":"Paragraph default"}]}]},"placeholder":"body:1"}
```

**三层一层都没读**：`master` 没有任何字段承载 `p:txStyles`，`layout.defaults.title` 里没有 `a:lstStyle` 的痕迹，第三段的 `a:defRPr sz="1200"` 连 `attrs` 都没产生。所有 run 的 `marks` 都是 `undefined`，画布一律落到 `DEFAULT_FONT_SIZE`（18pt）+ `DEFAULT_FONT_FAMILY`（Arial）+ 黑色。

**这不是边角**：PowerPoint 生成的占位符文本几乎从不在 run 的 `rPr` 上写字号字体，全靠这三层。所以导入任何真实 PPT，标题都不再是 44pt 粗体、正文都没有项目符号与缩进 —— 与阅读器的差异是全页级的。

**顺带记录一个观察**：master/layout 占位符的 `defaults.body` 现在是 `{"paragraphs":[{"runs":[]}]}` —— 一个空段落。这是上一批切片让 `parseDefaults` 调 `parseTextBody` 的产物，而 PowerPoint 的 master 占位符 `txBody` 按惯例只有 `<a:lstStyle/>` 与一个空 `<a:p>`。它不造成可见问题（元素总有自己的 `body`，整体覆盖时胜出），但**它正是 `a:lstStyle` 所在的那个 `txBody`**，本切片要从同一个节点多读一样东西。

## 3. 关键决策

**决策 1：`LevelDefaults` 同时读段落属性与 run 默认，不只读 `defRPr`**

```ts
export interface LevelDefaults {
  level: number                 // 0-8，对应 a:lvl1pPr … a:lvl9pPr
  attrs?: TextParagraphAttrs    // a:lvlNpPr 自身：algn/marL/indent/lnSpc/spcBef/spcAft/buChar…
  marks?: TextMarks             // 其 a:defRPr
}
```

**理由是段落属性几乎免费，而漏掉它会丢项目符号**：`a:lvlNpPr` 与 `a:pPr` 都是 `CT_TextParagraphProperties`，属性集相同，已有的 `parseParagraphAttrs` 直接复用；`TextParagraphAttrs` 也早已有 `align`/`level`/`indent`/`marginLeft`/`lineSpacing`/`spaceBefore`/`spaceAfter`/`bullet` 全部字段。真实 master 的 `p:bodyStyle` 正是项目符号与悬挂缩进的唯一来源（`marL="342900" indent="-342900"` + `buChar`），只读 `defRPr` 会让导入的正文变成没有 `•` 的平段落 —— 与字号错一样刺眼。

**决策 2：三层一次做完，不拆成「先两层」**

段落级 `a:pPr/a:defRPr` 进 `TextParagraphAttrs.defaultMarks`，代价只是在 `parseParagraphAttrs` 里多调一次已有的 `parseRunMarks`。拆开会留下「合并函数只认两层、下切片再改签名」的中间态，而三层的合并顺序本来就是同一个函数一次写清。

**决策 3：`listStyle` 挂 `ElementDefaults`，不挂 `TextBody`**

`a:lstStyle` 在 XML 里确实是 `CT_TextBody` 的子元素，但语义上它是**该占位符的默认**，与 `bounds`/`fill` 同类，而 `body` 是**实际内容**。放进 `TextBody` 会让每个表格单元格的 `body` 也长出这个字段（`serializeTextBodyXml` 是表格与形状共用的那条路径），而表格单元格的分级默认根本不走占位符继承。

`SlideMaster` 则新增 `textStyles?: TextStyles`，与 `colorMap` 同级 —— 它也是 master 级的共享资源。

**决策 4：合并函数放模型层，与 `resolveInheritedElement` 并列**

```ts
export function resolveTextBodyDefaults(element: Element, layout?: SlideLayout, master?: SlideMaster): TextBody | undefined
```

优先级由低到高：master `p:txStyles`（按占位符类型选 title/body/other，按段落 level 选档）→ master 占位符 `a:lstStyle` → layout 占位符 `a:lstStyle` → 段落 `attrs`/`defaultMarks` → run 的 `marks`。逐属性合并，不整体覆盖 —— 这正是它与已完成的占位符继承（`txBody` 级整体覆盖）的区别。

放模型层而不是 scenegraph 里，理由与 `resolveInheritedElement`、`resolveTableCellStyle` 一致：它是纯数据推导，engine 与导出端将来也可能要用同一份语义；scenegraph 只负责调用。

**占位符类型到样式表的映射**：`title`/`ctrTitle` → `title`，`body`/`subTitle`/`obj` → `body`，其余 → `other`。模型里的 placeholder key 形如 `title`、`body:1`，取 `:` 前一段判断。

**决策 5：写回必须与解析对称，否则编辑一次就丢**

已核实 `master-layout-writeback.ts:392` 在需要重写时 **整体替换 `p:txBody`**（`{start: sourceBody.start, end: sourceBody.end}`），而 `serializeTextBodyXml` 现在硬输出一个空的 `<a:lstStyle/>`。所以：

- `serializeTextBodyXml(body, prefix, listStyle?)` 增加可选的 `listStyle`，有值时输出完整 `<a:lstStyle>`，无值时保持今天的 `<a:lstStyle/>`
- `sourceTextBody` 一侧也读源里的 `a:lstStyle`，比较时两边都带上 —— 否则「源与模型的 lstStyle 相同」会被判成不等，导致未编辑的占位符被无谓重写
- 段落的 `defaultMarks` 同样两侧对称：`serializeParagraph` 输出 `<a:pPr><a:defRPr…/></a:pPr>`，`sourceTextBody` 的段落解析读它

`p:txStyles` 在 `p:sldMaster` 下、不在任何 `txBody` 内，`master-layout-writeback` 从不碰那个区间，因此**只读不写即可保证不丢**。本切片不给它写回，与「没有命令能改它」一致。

**决策 6：不做编辑命令与 UI**

分级默认是 master 级共享资源，改一处影响所有同类占位符 —— 那是「母版编辑」特性，与 `setThemeColor`/`setThemeFont` 同级但独立。本切片只做读取、合并、渲染、往返保真。

**决策 7：表格单元格不走这条链**

表格文本的默认来自 `p:otherStyle`，但表格已有 `tableStyles` 的文本样式链路（`resolveTableCellStyle`）。把两套默认叠起来需要单独想清优先级，本切片只做形状与占位符文本。

## 4. 契约（增量）

`@ppt4ai/model` 新增导出：`LevelDefaults`、`TextStyles`、`resolveTextBodyDefaults`。

`ElementDefaults` 新增 `listStyle?: LevelDefaults[]`；`SlideMaster` 新增 `textStyles?: TextStyles`；`TextParagraphAttrs` 新增 `defaultMarks?: TextMarks`。三者都进 `validateDocument`。

`serializeTextBodyXml` 增加第三个可选参数 `listStyle`（既有两参数调用不变）。

## 5. 测试策略

- **导入**：`p:txStyles` 三套各自的 level 与 marks/attrs 进 `master.textStyles`；`a:lstStyle` 进 `defaults.listStyle`；`a:pPr/a:defRPr` 进 `attrs.defaultMarks`；缺失的层级不产生条目
- **合并**：标题走 titleStyle、正文走 bodyStyle、其他走 otherStyle；level 选档正确（段落无 `lvl` 时取 level 0）；四层优先级逐属性覆盖；run 自己的 marks 永远最高
- **渲染**：场景图里标题 run 的 marks 反映 44pt 粗体，正文 lvl2 反映 24pt 斜体，项目符号与缩进出现在排版结果里
- **往返**：未编辑时 `a:lstStyle` 与 `p:txStyles` 逐字保留（含 `a:extLst` 等不建模内容）；编辑占位符文本后 `a:lstStyle` 仍在
- **回归**：现有 970+ 项测试不受影响 —— 尤其 `serializeTextBodyXml` 的表格路径输出不变

## 6. 已知限制

- 分级默认只读不可改（决策 6），`p:txStyles` 也不写回
- 表格单元格不参与（决策 7）
- `p:presentation/p:defaultTextStyle`（演示文稿级默认，优先级最低的一层）仍不读
- 形状自身 `txBody` 里的 `a:lstStyle`（非占位符形状）仍不读 —— 只读 layout/master 占位符那两处
- `a:lvlNpPr` 的 `defTabSz`/`rtl`/`eaLnBrk` 等未建模属性在整体重写 `txBody` 时仍会丢

## 7. 验证结果（2026-09-03）

探针测试证实三层默认格式已全部实现并正常工作：

1. **Master `p:txStyles`** ✅ 已读取到 `master.textStyles.title` 和 `.body`
2. **Layout `a:lstStyle`** ✅ 已读取到 `layout.defaults.title.listStyle`
3. **段落 `a:pPr/a:defRPr`** ✅ 已读取到 `paragraph.attrs.defaultMarks`

测试验证：
- 导入端 `importer.ts` 中 `parseListStyle`、`parseTextStyles` 已实现
- 渲染端 `scenegraph.ts` 中 `resolveRunMarks` 已合并三层默认格式
- 导出端 `master-layout-writeback.ts` 通过"最小差异替换"策略保留源文件的 `lstStyle` 和 `defRPr`
- 存在完整的测试套件 `level-defaults.test.ts` 验证三层合并逻辑

本设计文档写作时认为"三层一层都没读"，但实际上在文档写作前的某次提交中该功能已经完整实现。

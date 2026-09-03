# standalone 导出格式方案设计

> 状态：待实现（2026-09-03）
> 日期：2026-09-03

## 1. 目标

让 standalone 导出把模型里的 `formatScheme` 真的写进 `fmtScheme`。上一个切片（主题线条样式）在「已知限制」里点名了这处，探针一做发现它比「丢主题」严重得多：**导出的文件里每个样式矩阵引用都悬空**。

## 2. 探针结果（实测）

一份带完整 `formatScheme` 的文档（两个填充条目、两个线条条目、一个背景条目），页上一个只靠 `p:style` 取色的形状，外加一个 `p:bgRef` 背景，走 `createPptx` 导出：

```
fmtScheme : <a:fmtScheme name="Office"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme>
p:style   : <p:style><a:lnRef idx="2">…</a:lnRef><a:fillRef idx="1">…</a:fillRef><a:effectRef idx="0">…</a:effectRef><a:fontRef idx="minor">…</a:fontRef></p:style>
p:bg      : <p:bg><p:bgRef idx="1001"><a:schemeClr val="lt1"/></p:bgRef></p:bg>
lineStyles: undefined
```

**四个列表全是空的，而幻灯片照旧写出 `idx="2"`、`idx="1"`、`idx="1001"`** —— 每个引用都指向不存在的条目。重新导入回来 `formatScheme` 是 `undefined`。

后果不是「主题退化成默认」，而是**编辑器与导出文件互相矛盾**：场景图对着内存里的主题解析，画布上填充与轮廓都在；同一份文档导出成文件后，阅读器找不到条目，形状没有填充也没有轮廓。这个矛盾今天没有任何测试覆盖 —— `standalone.test.ts` 里的往返只检查形状自己的 `spPr`，从不检查 `p:style` 指向的条目是否存在。

## 3. 关键决策

**决策 1：`null` 条目必须占住自己的位置，写 `<a:noFill/>`**

索引是**按位置**算的：若跳过一个 `null` 条目，它后面每个条目都往前挪一格，于是全文档的 `fillRef idx="3"` 都指错。所以 `null` 必须占位。

写什么？**`<a:noFill/>`，不是 `phClr` 占位色**。`null` 的语义是「这个条目我们表达不了」（渐变、图案、图片），而 `resolveStyleFill` 对 `null` 条目**本来就返回 `undefined`、画布本来就不填充**。写 `<a:noFill/>` 让文件与画布说同一句话；写一个 phClr 实色会让文件比画布多出一块颜色，属于本项目一直拒绝的「发明近似值」。

**否决「跳过 null 条目」**：那是静默的索引错位，比少一块颜色难发现得多。

**决策 2：模型没有 `formatScheme` 时写 Office 的默认三条，不写空列表**

这条**不是新发明**：同一个函数里颜色缺槽位落到 `DEFAULT_THEME_COLORS`、字体缺槽位落到 `DEFAULT_THEME_FONTS`（`standalone-xml.ts:120,129`），「standalone 用 Office 默认补齐主题未知部分」是这条路径早就定下的决策。格式方案照同一条办。

真实 Office 主题的这四个列表**各有且只有三条**，线宽是 6350/12700/19050（0.5/1/1.5pt）。因此默认三条填充为 `phClr` 实色、三条线条为那三个宽度的 `phClr` 实线、三条背景为 `phClr` 实色。这样 `idx="1..3"` 与 `idx="1001..1003"` 至少都能落到条目上。

**未经核实的一点**：ECMA-376 对这四个列表是否要求 `minOccurs="3"`，本切片**没有用校验器实测**。写三条的理由是「与真实 Office 文件一致」，不是「schema 强制」—— 不把没验过的结论写成结论。

**决策 3：条目数不足时补到三条，但绝不截断**

模型只有两个线条条目时补第三条默认值；有五条就全写五条。补齐是为了让 `idx="3"` 这种常见引用有着落，截断则会把模型里已有的条目丢掉，方向相反。

**决策 4：`effectStyleLst` 写三条空效果**

效果完全不建模（`effectRef` 只存不用），但它同样按索引引用。写 `<a:effectStyle><a:effectLst/></a:effectStyle>` 三条：引用有着落、解析结果是「无效果」，与渲染端今天的行为一致。**不发明阴影**。

**决策 5：`bgFillStyleLst` 的索引偏移在导出端还原**

模型里背景 `styleRef.idx` 保留文件自己的 1001 起编号（背景切片的决策），`resolveSlideBackground` 解析时减 1000。导出端写列表时不需要动索引 —— 列表本身是 1 基的，偏移只属于引用侧，而引用侧原样写出。这条容易写错，因此单独用「模型 1001 → 列表第一条」的测试钉住。

## 4. 契约（增量）

`serializeThemeXml(theme?)` 从 `theme.formatScheme` 生成 `fmtScheme` 的四个列表，缺失或不足时以 Office 默认补齐。

新增导出的默认常量放在 `@ppt4ai/model`（与 `DEFAULT_THEME_COLORS`/`DEFAULT_THEME_FONTS` 同处），使「默认值只有一处」继续成立。

## 5. 测试策略

- **序列化**：三种列表按模型条目逐条写出（线条条目带 `w` 与 `prstDash`）；`null` 写 `<a:noFill/>` 且占住位置；无 `formatScheme` 时写三条默认；条目不足三条时补齐、超过三条时全留
- **往返**：导出再导入拿回同一个 `formatScheme`（`null` 仍是 `null`）；形状的 `lnRef`/`fillRef` 与背景 `bgRef` 在导出的包里都能解析到条目
- **索引**：模型 `idx=1001` 的背景解析到列表第一条（决策 5）
- **回归**：现有 1151 项测试，尤其 `standalone.test.ts` 里断言过 `<a:fmtScheme…/>` 整段字符串的地方

## 6. 已知限制

- 默认三条是照真实 Office 文件写的，不是照 schema 校验器验的（决策 2）
- 渐变/图案/图片条目仍写 `<a:noFill/>`，导出后那些条目的原始形态不可恢复（模型里本来就只有 `null`）
- `effectStyleLst` 写三条空效果，源文件的阴影发光在无源生成路径上不可恢复（决策 4）
- 线条条目的 `cap`/`cmpd`/`algn`/`join` 不建模，因此不写出
- 范围写回路径不受影响：它从不触碰 `fmtScheme`，源里的列表原样保留

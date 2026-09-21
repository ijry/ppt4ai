# 主题字体写回与编辑命令设计

> 状态：已实现（2026-09-03）
> 日期：2026-09-03

## 1. 目标

让主题字体能改：`rewriteThemeXml` 按最小差异写 `a:fontScheme`，engine 新增 `setThemeFont`。面板 UI 留到下一切片。

## 2. 为什么写回必须先于命令

上一切片（`de59927`）把 `fontScheme` 读进了 `Theme.fonts`，但 `rewriteThemeXml` 只改 `clrScheme`。已核实 `fingerprintDocument` 走 `canonicalJson(整份文档)`，`fonts` 自动进指纹 —— 一旦先有命令，字体改动会让指纹变化、导出走写回路径，而 `rewriteThemeXml` 认不出字体，编辑就在函数内部被静默丢弃。这正是 `a23c694` 修过的那类问题，顺序反了就会重演。

## 3. 关键决策

**决策 1：只改 `typeface` 属性的值，其余字节不动**

源里的 `<a:latin typeface="Cambria" panose="02040503050406030204" pitchFamily="18" charset="0"/>` 有三个我们不建模的属性，`<a:font script="Hans" typeface="…"/>` 兄弟节点也不建模。`XmlElement` 只有 `start`/`end` 与解码后的 `attributes`，没有单个属性的位置，因此在开标签切片上用正则定位 `typeface="…"`（或 `'…'`）并只替换引号内的区间；属性不存在时在元素名后插入。这比「重建整个开标签」保留得多：引号风格、属性顺序、空白全部原样。

**决策 2：比较用 trim 后的值**

导入端 `parseThemeFontFace` 对 `typeface` 做了 `trim()`，所以源里的 `" Cambria "` 进模型是 `"Cambria"`。若逐字比较，未经编辑的文档一导出就会被改写。判据取 `源值.trim() === 生效值`，与「未编辑不重写」这条既有纪律一致。

**决策 3：缺失层级分两种处理，与颜色同构**

| 缺什么 | 做什么 | 依据 |
|---|---|---|
| `a:fontScheme` | 抛 `PPTX export theme source malformed` | 与缺 `a:clrScheme` 同（既有行为） |
| `a:majorFont` / `a:minorFont` | 新建，三个 script 子节点齐全 | `CT_FontCollection` 要求 latin/ea/cs 都在；未建模的 script 用 `DEFAULT_THEME_FONTS`，与 `serializeThemeXml` 写的一致 |
| `a:latin` / `a:ea` / `a:cs` | 按 schema 顺序插入 | `CT_FontCollection` 是有序序列 |

**注意 `theme.fonts` 完全没有值时，字体一侧一行都不执行** —— 否则现有夹具（`<a:fontScheme data-font="keep"/>`，自闭合、无子元素）一导出就会抛错或被改写。既有三条断言正是固定它逐字保留。

**决策 4：插入位置按 schema 顺序，不像颜色那样一律追加到末尾**

新增 `insertChildXml`，未知子元素（`a:font`、`a:extLst`）视为排在所有已知名之后，因此 `a:latin` 会插到 `a:extLst` 之前。**没有顺延去修颜色那侧同样的问题**：`CT_ColorScheme` 也是有序序列，而既有代码把缺失槽位追加到 `clrScheme` 末尾，`theme-writeback.test.ts:28` 正在断言那个位置。改它要一并改断言，且真实主题 12 个槽位从不缺失 —— 属独立清理，不混进本切片。

**决策 5：命令补丁打在 `fonts` 整体上，不打叶子**

`setAt` 在中间对象缺失时抛 `patch path does not exist`。`setThemeColor` 能打 `['themes', id, 'colors', slot]` 是因为 `colors` 是必填字段一定存在，而 `fonts` 是可选的，`fonts.major` 也可能不存在。因此补丁路径取 `['themes', id, 'fonts']`、值为新的整份 `fonts`（最多 6 个字符串），父节点必然存在，inverse 也能原样恢复「原本没有 `fonts`」。这与 `transform`、`borders` 那两条既有的「整体对象补丁 + `undefined` 删除」用法同款。

**决策 6：只提供「重置为默认」→ `null`，不提供「恢复源值」→ `undefined`**

沿用 theme-editing-ui 决策 3 的取舍与理由，签名 `typeface: string | null`。undo/redo 已覆盖「改错了想回去」。

## 4. 契约（增量）

engine 新增命令：

```ts
| { type: 'setThemeFont'; themeId: string; slot: ThemeFontSlot; script: ThemeFontScript; typeface: string | null }
```

错误信息沿用颜色那侧的措辞：`theme not found: …`、`unsupported theme font slot: …`、`unsupported theme font script: …`、`theme font is invalid: …`。

`rewriteThemeXml(source, theme)` 签名不变，新增 `PPTX export theme font unsupported: <id>.<slot>.<script>` 一种错误。

## 5. 测试策略

- **写回**：改一个 typeface 时 `panose`/`pitchFamily`/`charset` 与 `<a:font script>` 逐字保留；未变时返回源对象本身（`toBe`）；源值带空白时不重写；`null` 落到内置默认；缺 `a:latin` 时按顺序插到 `a:extLst` 之前；缺 `a:majorFont` 时新建且三个 script 齐全；缺 `a:fontScheme` 时抛错；`theme.fonts` 为空时源逐字不变；非法字体名抛稳定错误
- **命令**：写入一个 script；`null` 重置；undo 恢复到「原本没有 `fonts`」；redo 往返；未知主题/槽位/script/空字符串报错且不入栈、不改文档；无变化不入栈
- **端到端**：改字体 → 导出 → XML 变了 → 重新导入模型一致；未改字体的文档导出后主题部件字节不变

## 6. 已知限制

- 面板 UI 与 playground 接线仍未做（下一切片），所以用户仍无法在界面上改字体
- `<a:font script="…">` 按脚本回退表仍不建模，只被原样保留
- `fmtScheme` 仍不在模型中
- 颜色那侧缺失槽位仍追加到 `clrScheme` 末尾而非按序插入（决策 4）

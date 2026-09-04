# 母版与版式的图片背景设计

> 状态：设计中（2026-09-04）
> 日期：2026-09-04

## 1. 目标

让**幻灯片之上**的图片背景跨过文件边界。这是前四刀反复点名的最后一条：颜色映射、背景色、`p:txStyles`、占位符默认值、多母版多版式都通了，只有母版/版式上的 `a:blipFill` 背景两头都断着 —— **导入读不到，导出写不出**。

渲染端本来就支持它：`resolveSlideBackground` 与 `documentToSceneGraph` 沿 幻灯片 → 版式 → 母版 取第一个声明了背景的那层，图片背景一并取（`scenegraph.ts:691`）。因此这一刀修的是 I/O，画布不用动 —— 而修好之后，真实文件里「母版上放一张整页底图」这种极常见的做法才会在画布上出现。

## 2. 现状（读代码所得）

- **导入**：幻灯片走 `parseBackgroundPictureFill(common, slidePath, slideRelations, entries, …)`（`importer.ts:1813`），而母版与版式走的是 `parseBackground(container)`（`1551`、`1563`）—— **那个函数没有部件路径、关系表与字节，因此只能读纯色与 `bgRef`，`a:blipFill` 直接被跳过**
- **导出**：`serializeBackgroundXml(background, relationshipId?)` 只在拿到关系 id 时写图片分支，而母版/版式的调用点一个 id 都没传，于是图片背景**静默退化成没有背景**
- 因此 `master.background.pictureFill` 这个字段今天**无法被任何路径填上**：导入读不到，编辑器没有改母版背景的命令 —— 模型里声明了却永远为空

## 3. 关键决策

**决策 1：两侧一刀做完，验收条件是往返**

只补一侧都验不了：只改导出，模型里永远没有图片背景可写；只改导入，读进来的东西一导出就丢。与表格样式那一刀同样的理由 —— 往返测试是唯一能同时压住两侧的判据。

**决策 2：导入侧复用 `parseBackgroundPictureFill`，母版/版式各自的关系表**

`p:bg` 在三种部件里结构相同（`p:bgPr/a:blipFill`），差别只在**关系表属于哪个部件**。因此把部件路径、关系表与 entries 传进 `parseMaster`/`parseLayout`，让它们调用同一个函数 —— 不新写一份解析。

**决策 3：资产注册在循环体里直接 `await`，不进缓冲区**

表格单元格那一刀用缓冲区，是因为单元格遍历是同步嵌套函数、无法 `await`。母版/版式的解析是在幻灯片循环体里直接调用的，因此让它们**返回**「解析结果 + 可选的背景资产」，由调用方注册并当场 `await`。缓冲区在这里是多余的机制。

**决策 4：导出侧的关系排在既有关系之后**

母版关系表：版式 `rId1..k`、主题 `rId(k+1)`、图片 `rId(k+2)…`；版式关系表：母版 `rId1`、图片 `rId2…`。与上一刀同一条原则 —— 新关系只能往后加，既有编号不动，所以既有测试全部继续成立。

**决策 5：媒体部件全包共享，关系逐部件各写一份**

`materializeAssets` 按 assetId 去重、一张照片只落一个 `ppt/media/imageN.png`；母版、版式与幻灯片各自在自己的关系表里指向它。这是 OOXML 本来的样子，也不需要改物化逻辑 —— 只需要让它**也走一遍母版与版式的背景**，否则序列化时会抛 `asset materialization missing`。

## 4. 契约（增量）

`@ppt4ai/pptx-import`：`parseMaster`/`parseLayout` 接受媒体上下文并返回可选的背景资产；母版/版式的 `p:bg` 支持 `a:blipFill`（含 `srcRect`/`tile`/`fillRect`/blip 效果，全部复用既有解析）。

`@ppt4ai/pptx-export`：`materializeAssets` 走母版/版式背景；`serializeMasterXml`/`serializeLayoutXml` 接受背景关系 id；`serializeMasterRelationshipsXml`/`serializeLayoutRelationshipsXml` 接受图片关系。

模型与渲染不动。

## 5. 测试策略

- **导入**：母版上的 `a:blipFill` 背景进模型（含 `srcRect` 与 `tile`）；版式上的同样；媒体只注册一份资产；非位图媒体走 `onIssue` 上报（与幻灯片侧同一条）
- **导出**：母版/版式的 `p:bg/p:bgPr/a:blipFill` 写出，关系 id 排在既有关系之后；媒体部件只有一份而三处各有自己的关系
- **往返**：母版图片背景 + 版式图片背景 + 幻灯片图片背景共用同一张照片，一趟下来三处都回来，且 `ppt/media` 只有一个文件
- **回归**：现有 1717 项

## 6. 已知限制

- 编辑器仍没有改母版/版式背景的命令（模型与两端 I/O 齐了，UI 未做）
- `p:bg` 的其余形态（渐变已建模、图案填充仍不建模）不变
- 母版/版式里除背景之外的媒体（例如占位符自己的图片填充）仍不物化 —— 占位符 `defaults` 不带 `pictureFill` 字段
- 仍无阅读器实测

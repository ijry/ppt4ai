# 幻灯片图片背景源写回设计

> 状态：已实现（2026-09-21，幻灯片级）
> 日期：2026-09-21

## 1. 目标

让**幻灯片**的图片背景(`p:bg/a:blipFill`)能经源写回引入/修改。此前 `backgroundReplacements` 遇到 `pictureFill` 一律不改源(注释写"没有命令能要求媒体部件"),现在媒体物化管线已具备,补上这一路。

## 2. 关键决策

**决策 1：复用图片元素那套媒体物化**

把 `imageBytes` 抽成 `mediaForAsset(state, assetId)`(按 assetId 物化,`imageBytes` 委托它),这样背景图片与图片元素共用一个媒体部件、共用 `pendingMedia`/content-types 登记,同一资产只写一份。

**决策 2：`backgroundReplacements` 收 `pictureRelationshipId` 参数**

背景是图片且与源资产不同时,调用方(写回主循环)先 `mediaForAsset` 物化、`allocateRelationshipId` 分配关系 id、`serializeImageRelationship` 加进该页 rels,再把 id 传进 `backgroundReplacements`。函数用共享的 `serializeBackgroundXml` 写出 `p:bg/a:blipFill`(整块替换或在 `p:spTree` 前插入)。无 id(资产解析不出)时保持旧行为——不改源。

**决策 3：未编辑仍逐字节相同**

`backgroundAsset === scanned.backgroundAssetId` 时不物化、不分配关系,`backgroundsEqual` 判等短路,源不动。

## 3. 测试策略（TDD）

- **写回**（`pptx-export/slide-picture-background-writeback.test.ts`,2 项）：引入图片背景→写出媒体部件 + 关系 + `a:blipFill`(带 `srcRect`)、不留 solidFill、往返回图片背景;未编辑逐字节相同。
- **回归**：`background-picture.test.ts` 既有 7 项仍过;全量 2435 项。

## 4. 已知限制

- **仅幻灯片级**。母版/版式的图片背景源写回仍未做——`rewriteSourceMastersAndLayouts` 目前是同步、无 `ImageWritebackState`,要引入媒体物化需把它改成 async 并接入各自 rels 文件,是独立后续切片。standalone 生成的母版/版式图片背景早已完整。
- 引入图片背景需 `document.assets` 带该资产元数据且 adapter 能取到字节(与图片元素同前提)。

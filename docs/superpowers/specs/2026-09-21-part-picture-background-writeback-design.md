# 母版/版式图片背景源写回设计

> 状态：已实现（2026-09-21）
> 日期：2026-09-21

## 1. 目标

把上一刀(幻灯片图片背景源写回)延伸到**母版/版式**。此前 `rewriteSourceMastersAndLayouts` 是同步、不接触媒体,母版/版式的图片背景写不出;这是背景写回的最后一个缺口。

## 2. 关键决策

**决策 1：`rewriteBackground` 收 `pictureRelationshipId`,不再对 pictureFill 一律 bail**

`master-layout-writeback.ts` 的 `serializePartBackgroundNode` 加图片分支(复用从 `standalone-xml` 导出的 `serializeBlipFillXml`),`rewriteBackground` 在有关系 id 时按幻灯片同款规则写出/替换/插入 `p:bg/a:blipFill`;无 id(未变或资产解析不出)则保持不改源。`rewriteMasterXml`/`rewriteLayoutXml` 多收一个 `backgroundPictureRelationshipId`。

**决策 2：`rewriteSourceMastersAndLayouts` 改成 async,接入 `ImageWritebackState`**

新增 `partBackgroundPictureRelationship`:当母版/版式背景是图片且与源资产不同时,`mediaForAsset` 物化媒体(与幻灯片、图片元素共用一份、共用 content-types 登记),在该部件自己的 `.rels` 里 `allocateRelationshipId` + `appendRelationships` 加图片关系,返回 id。调用点从 `exportPptx` 早期移到 `state` 建好之后(因此得以共享媒体池)。

**决策 3：两处基础设施加固**

①`appendRelationships` 现能处理自闭合的 `<Relationships/>`(空 rels 部件),展开成成对标签再插入。②`ensureRelationshipNamespace` 给引入了 blip 的母版/版式根元素补 `xmlns:r`(有了 `r:embed` 才需要)。

## 3. 测试策略（TDD）

- **写回**（`pptx-export/part-picture-background-writeback.test.ts`,3 项）：母版图片背景→写媒体+关系+`a:blipFill`(带 srcRect)、往返;母版与版式共享一个媒体部件、版式根补 `xmlns:r`;未编辑逐字节相同。
- **回归**：`standalone-inherited-background`、`master-layout-writeback`、`background-picture`、`slide-picture-background-writeback` 全过;全量 2438 项。

## 4. 已知限制

- 引入图片背景需 `document.assets` 带元数据且 adapter 能取字节(与幻灯片同前提)。
- 编辑器仍无改母版/版式背景图片的 UI(engine 命令 `setMasterBackground`/`setLayoutBackground` 已能承载 pictureFill,写回已通,缺前端)。

**至此:幻灯片/母版/版式三层的纯色、渐变、图案、图片背景 —— 读取/解析/绘制/编辑/写回全部打通。**

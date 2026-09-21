# 幻灯片背景图片编辑控件设计

> 状态：已实现（2026-09-21）
> 日期：2026-09-21

## 1. 目标

收尾背景面板:加**图片背景选择器**。图片背景已能读取/解析/绘制/写回(含幻灯片与母版/版式写回),面板补上"从已有资产里选一张作背景"。

## 2. 关键决策

**决策 1：面板模型加 `pictureAssetId`,面板 prop 收 `pictureAssets`**

`slideBackgroundModel` 只从背景派生 `pictureAssetId`(当前图片背景资产,无则 `''`)——保持模型纯净、不依赖资产库。可选资产清单由宿主通过 `pictureAssets: { id, label }[]` prop 传入(浏览器不能枚举字节,资产是宿主的)。面板仅在宿主给了非空清单时渲染图片 `fieldset`(否则隐藏,避免空下拉)。

**决策 2：`set-picture` 只发 assetId**

选择器发 `set-picture assetId`,宿主组 `{ pictureFill: { assetId } }` 交给 `setSlideBackground`。engine 校验资产存在、写回(幻灯片与母版/版式)都已支持,因此端到端可用。不新增图片(那是资产上传流,已有 `AssetLibrary`)。

**决策 3：playground 接线**

`App.vue` 用 `backgroundPictureAssets` 从文档 `assets` 映射 `{ id, label: originalFilename ?? id }`,`setSlideBackgroundPicture` → `setSlideBackground({ pictureFill: { assetId } })`。

## 3. 测试策略（TDD）

- **模型**（+2）：报告图片背景 assetId;无图片背景时报 `''`。纯色 `toEqual` 补 `pictureAssetId: ''`。
- **组件**（+1）：宿主无资产时不渲染图片 fieldset;给资产后改选择器→发 `set-picture`。
- **回归**：全量 2460 项。

## 4. 已知限制

- 只从**已有资产**里选;上传新图走既有 `AssetLibrary`,再在此选中。
- 面板不编辑图片的裁剪/平铺/效果(能读能画能保,面板只切换用哪张)。

**至此:幻灯片背景的纯色/渐变/图案/图片四种填充在面板里都可编辑,且经 engine + 写回端到端往返。**

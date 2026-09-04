# 拉伸矩形（`a:fillRect`）设计

> 状态：设计
> 日期：2026-09-04

## 1. 目标

让 `a:stretch/a:fillRect` 的四个内缩进入模型并影响绘制。这是形状图片填充那一刀记下的最后一条延期：今天四个属性被丢弃，照片一律按整个形状框拉伸，因此 PowerPoint「填充」式裁剪（常见写法是 `l="-10000" r="-10000"` 这种**负值外扩**）画出来的取景是错的。

## 2. 探针结果（实测）

一个 `a:blipFill`，`a:stretch` 带 `l="-10000" t="5000" r="-10000" b="5000"`（`fillrect-probe.test.ts`，已删除）：

```
pictureFill: {"assetId":"asset_ppt_media_image1_png"}
```

四个内缩**一个都没进模型**，绘制因此按整框拉伸。

## 3. 关键决策

**决策 1：单独的类型，值带符号**

```ts
export interface PictureStretch {
  /** `a:fillRect/@l`/`@t`/`@r`/`@b`，千分之一百分比，**可为负**（负值向外扩）。 */
  left?: number
  top?: number
  right?: number
  bottom?: number
}
```

**不复用 `ImageCrop`**：那是 `a:srcRect` 的类型，校验要求 `0..100000` 非负 —— 而 `a:fillRect` 的负值正是「填充式裁剪」的表达方式，塞进同一个类型会让合法文件被校验拒掉。两者语义也不同：`srcRect` 裁的是**源图**，`fillRect` 定的是**目标框**。

**决策 2：只对 `a:stretch` 生效**

`a:fillRect` 是 `a:stretch` 的子元素；`a:tile` 有自己的 `tx`/`ty`/`sx`/`sy`。因此平铺分支不读它，模型也只在没有 `tile` 时记录它（与「平铺与拉伸互斥」同一条）。

**决策 3：绘制按百分比换算目标框**

`x = bounds.x + bounds.w · l/100000`，`w = bounds.w · (1 − (l+r)/100000)`，纵向同理。这是 `fillRect` 的定义本身，不发明数值。宽或高换算成非正数时**跳过绘制**（那描述的是一个空目标框），而不是画一个反向的矩形。

## 4. 契约（增量）

`@ppt4ai/model`：新增 `PictureStretch`；`PictureFill` 新增 `stretch?`；校验为带符号整数。

`@ppt4ai/pptx-import`：`a:stretch/a:fillRect` 的四个属性进模型。

`@ppt4ai/render`：`ScenePictureFill` 透传。

`@ppt4ai/editor`：`paintPictureFill` 的拉伸分支按决策 3 算目标框。

`@ppt4ai/pptx-export`：`serializeFillModeXml` 写出四个属性。

## 5. 测试策略

- **导入**：四个属性（含负值）各自进模型；缺省与空 `a:fillRect` 时字段缺席；有 `a:tile` 时不记录
- **模型**：负值通过校验，非整数被拒
- **绘制**：目标框按百分比换算（含负值外扩）；空目标框不绘制；不影响平铺分支
- **往返**：standalone 写出四个属性并能重新导入；未编辑源包逐字节不变
- **回归**：现有 1653 项

## 6. 已知限制

- `a:fillRect` 只作用于图片填充；`a:gradFill` 的 `a:tileRect` 仍不建模
- 平铺分支不读它（决策 2）

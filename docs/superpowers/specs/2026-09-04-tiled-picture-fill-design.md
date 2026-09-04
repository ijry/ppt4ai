# 平铺图片填充与 blip 效果设计

> 状态：设计
> 日期：2026-09-04

## 1. 目标

补掉形状图片填充那一刀记下的两条延期：`a:tile`（平铺）与 `a:blip` 下的效果（`alphaModFix`、`grayscl`）。今天前者让整个填充被丢弃（形状什么都不画），后者让半透明或灰度的照片画成不透明的彩色照片。

## 2. 探针结果（实测）

两个形状，一个 `a:tile`、一个 `a:stretch` 且 blip 带两个效果（`tile-probe.test.ts`，已删除）：

```
el_1: pictureFill=undefined                                    ← a:tile，整个填充被丢
el_2: pictureFill={"assetId":"asset_ppt_media_image1_png"}      ← 两个效果都没进来
assets: ["asset_ppt_media_image1_png"]
```

`el_1` 的形状因此**一个像素都不画**；`el_2` 的 `alphaModFix amt="40000"` 与 `grayscl` 被丢，照片画成全不透明的彩色。

## 3. 关键决策

**决策 1：`a:tile` 用 canvas 的 pattern 画，六个属性里能兑现的都兑现**

```ts
export interface PictureTile {
  /** `@tx`/`@ty`，EMU。 */
  offsetX?: number
  offsetY?: number
  /** `@sx`/`@sy`，千分之一百分比，作用于源图的原始尺寸。 */
  scaleX?: number
  scaleY?: number
  /** `@algn` 逐字：第一块瓦片贴在形状框的哪个角。 */
  align?: string
  /** `@flip` 逐字；绘制不镜像相邻瓦片，见限制。 */
  flip?: string
}
```

`createPattern(image, 'repeat')` 加 `pattern.setTransform(...)` 正好表达「缩放 + 位移」的瓦片网格：源图原始尺寸按 96 dpi 换算成 EMU（`px × 9525`），再乘页面映射，因此 `sx`/`sy`/`tx`/`ty` 与 `algn` 都是**算得出的**，不发明数值。

**`@flip` 只保存不绘制**：`flip="x"` 要求相邻瓦片交替镜像，一个 `repeat` pattern 表达不了 —— 要先把 2×2 的镜像组合画到离屏画布再拿去平铺。那是独立一刀，代价写进限制。

**决策 2：`a:blip` 的效果复用 `ImageEffect[]`**

`p:pic` 侧早就有 `ImageEffect`（`alphaModFix`、`grayscl`）与对应绘制（`globalAlpha` 相乘、`filter: grayscale(1)`）。图片填充用**同一个类型、同一段绘制**，不新造第二套 —— 与 `sourceCrop` 复用 `ImageCrop` 同一条。

**决策 3：平铺与拉伸互斥，模型不表达「两个都有」**

OOXML 的 `a:blipFill` 里 `a:tile` 与 `a:stretch` 是一个 choice。模型因此把 `tile` 作为可选字段：在场即平铺，缺席即拉伸（含源文件根本没写 fill mode 的情形，与上一刀的决策一致）。

**决策 4：standalone 按模型写出，写回仍然不碰**

`serializePictureFillXml` 在有 `tile` 时写 `<a:tile>` 而不是 `<a:stretch>`，并把效果写进 `<a:blip>`。源包写回继续完全不碰 `a:blipFill`（上一刀的决策 7 未变）：没有命令能改这些值，模型值恒等于源值。

## 4. 契约（增量）

`@ppt4ai/model`：新增 `PictureTile`；`PictureFill` 新增 `tile?`、`effects?: ImageEffect[]`；两者进 `validateDocument`（效果复用图片那套校验）。

`@ppt4ai/pptx-import`：`a:tile` 的六个属性与 `a:blip` 的效果进模型；平铺不再被拒。

`@ppt4ai/render`：`ScenePictureFill` 透传 `tile` 与 `effects`。

`@ppt4ai/editor`：`paintPictureFill` 在有 `tile` 时走 pattern 分支；效果复用 `applyEffects`。

`@ppt4ai/pptx-export`：`serializePictureFillXml` 写 `a:tile` 与 blip 效果。

## 5. 测试策略

- **导入**：六个瓦片属性各自进模型，缺省时字段缺席；两个效果按顺序进模型；`a:tile` 的形状现在有 `pictureFill`
- **模型**：瓦片数值非整数/越界被拒；效果沿用既有校验
- **场景**：`tile` 与 `effects` 透传
- **绘制**：平铺走 `createPattern` + `setTransform`（矩阵按 `sx`/`tx`/`algn` 计算），拉伸仍走 `drawImage`；`alphaModFix` 乘到 `globalAlpha`、`grayscl` 设 `filter`；`flip` 不改变绘制
- **往返**：standalone 写出 `<a:tile>` 与效果并能重新导入；源包未编辑逐字节不变
- **回归**：现有 1602 项

## 6. 已知限制

- `@flip` 不绘制（决策 1）：镜像平铺画成非镜像的那一份，模型与文件逐字保留
- `a:stretch/a:fillRect` 的四个内缩属性仍不建模（上一刀已记），只按整框拉伸
- `a:blip` 的 `duotone`、`clrChange` 等其余效果仍不建模；`@rotWithShape` 仍不建模
- 表格单元格与幻灯片背景的 `a:blipFill` 仍不建模

# 径向渐变（`a:path`）设计

> 状态：已实现（2026-09-04，`afb9f71`）
> 日期：2026-09-04

## 1. 目标

让 `a:gradFill` 的 `a:path` 形态（径向/矩形/随形渐变）进入模型、画到画布、写回文件。今天这类填充**整块丢失**，而且比「退化成纯色」更糟：`parseGradientNode` 在没有 `a:lin` 时直接返回 `undefined`，`parseDirectFill` 于是连第一个停靠点的颜色都不给 —— **形状变成没有填充**。PowerPoint 的内置渐变预设里有好几个是径向的，因此这不是边角情形。

## 2. 现状（读代码所得）

- `importer.ts:379` `parseGradientNode`：`const linear = child(gradient, 'lin'); if (!linear) return undefined` —— 停靠点已经解析好了，却因为形态不认识而全部丢弃
- `Gradient`（`model/index.ts:269`）的注释明写着「只建模 `a:lin`，`a:path` 仍不可表达」
- 绘制共用 `packages/geometry` 的 `gradientAxis(bounds, angle, scaled)`，三条绘制路径（形状、幻灯片背景、缩略图 worker）各自拿它去 `createLinearGradient`
- 导出只有一处：`serializeFillXml` 写 `a:lin`，两条导出路径与写回替换都走它

## 3. 关键决策

**决策 1：模型按 OOXML 的二选一原样记，不强制互斥**

```ts
export interface Gradient {
  stops: GradientStop[]
  angle?: number          // a:lin
  scaled?: boolean        // a:lin
  path?: 'circle' | 'rect' | 'shape'   // a:path/@path
  fillToRect?: GradientFillToRect      // a:path/a:fillToRect，千分之一百分比内缩
}
```

`a:lin` 与 `a:path` 在 schema 里是 choice，但模型不强制：**手搭的文档同时写两者时，绘制以 `path` 为准**，与「同时有 `fill` 与 `pictureFill` 时图片优先」同一条处理方式 —— 校验拒绝合法数据不如让绘制有确定的优先级。

**决策 2：三个 `path` 词都画成圆形渐变，词本身原样保留**

canvas 只有 `createRadialGradient`（圆形）。`rect`（同心矩形）与 `shape`（随形）**没有原生对应**，因此三者都按圆形近似绘制，而模型把词原样存下来、原样写回 —— **近似只发生在绘制，文件不失真**。这与 `prstDash` 十一个词的处理同源：模型存词，绘制归组。

**决策 3：`fillToRect` 的中心是渐变的起点（offset 0），半径取到最远的角**

`a:fillToRect` 的语义是「渐变收敛到的矩形」，因此第一个停靠点落在那个矩形的中心，最后一个落在形状的边界。半径取「焦点到四个角的最大距离」，这样最后一个停靠点覆盖整个形状而不是在角上留一块未着色。缺 `a:fillToRect` 时四边内缩按 0 算（即整个形状框），焦点因此是框中心。

**这条是 spec 读法，不是实测**：`l=t=r=b=50000`（收敛到中心点）配「浅色在前、深色在后」的停靠点，画出来就是中心浅、边缘深 —— 与 PowerPoint 径向预设的观感一致，但本机无阅读器可核对，按仓库纪律标注为**待核对**。

**决策 4：非圆形的椭圆拉伸不做**

宽扁形状里 PowerPoint 的径向渐变是椭圆的，canvas 要靠 `context.scale` 变换模拟。这一刀不做：三条绘制路径都要各自处理变换与描边宽度的补偿，属独立一刀。记为已知限制。

**决策 5：焦点与半径的计算放 `packages/geometry`，与 `gradientAxis` 并列**

三条绘制路径已经共用 `gradientAxis`，径向同样只写一份 `gradientFocus(bounds, fillToRect)`，返回 `{ centre, radius }`。绘制侧的分支因此各只有两行。

## 4. 契约（增量）

`@ppt4ai/model`：`Gradient` 新增 `path`/`fillToRect`；`ResolvedGradient` 同样两个字段；`resolvedFillGradient` 透传；校验接受两者（`path` 限三个词，内缩为 0..100000 整数）。

`@ppt4ai/geometry`：新增 `gradientFocus(bounds, fillToRect?)`。

`@ppt4ai/pptx-import`：`parseGradientNode` 认 `a:path`（停靠点不再因形态不认识而丢弃）。

`@ppt4ai/pptx-export`：`serializeFillXml` 在有 `path` 时写 `a:path` + `a:fillToRect`。

`@ppt4ai/editor`：三处 `fillGradient` 分支到 `createRadialGradient`。

## 5. 测试策略

- **几何**：`gradientFocus` 的中心与半径（居中收敛、角落收敛、缺 `fillToRect`、退化的零尺寸框）
- **导入**：`a:path path="circle"` + `a:fillToRect` 进模型；`rect`/`shape` 同样；未知 `path` 词按缺席处理但停靠点仍在
- **模型**：校验接受三个词、拒绝第四个；解析后的 `ResolvedGradient` 带着两个字段
- **绘制**：三条路径各自用 `createRadialGradient` 且圆心半径符合决策 3；`a:lin` 的既有行为不变
- **导出与往返**：`a:path` 与四个内缩写出并读回；未编辑源包逐字节不变
- **回归**：现有 1743 项

## 6. 已知限制

- 椭圆拉伸不做（决策 4）
- `rect`/`shape` 按圆形近似（决策 2）
- `a:tileRect`、`a:gradFill/@rotWithShape`、`@flip` 仍不建模
- 决策 3 的停靠点方向**待阅读器核对**
- 仍无阅读器实测

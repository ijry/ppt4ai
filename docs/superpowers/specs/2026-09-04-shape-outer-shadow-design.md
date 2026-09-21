# 形状外阴影设计

> 状态：已实现（2026-09-04，`4cc4de7`）
> 日期：2026-09-04

## 1. 目标

让 `a:effectLst/a:outerShdw` 进入模型并画到画布。阴影是真实演示文稿里最常见的效果，而今天**整个效果列表在导入期被丢弃**，所有带阴影的形状都画成平的。

## 2. 探针结果（实测）

三个同样的形状，分别不带效果、带 `a:outerShdw`（`blurRad="50800" dist="38100" dir="2700000"`、40% 黑）、带 `a:glow`（`shadow-probe.test.ts`，已删除）：

```
el_1: {…,"fill":{"color":{"type":"srgb","v":"4472C4"}}}
el_2: {…,"fill":{"color":{"type":"srgb","v":"4472C4"}}}
el_3: {…,"fill":{"color":{"type":"srgb","v":"4472C4"}}}
```

**三个模型逐字相同** —— `a:effectLst` 一个字节都没读。

## 3. 关键决策

**决策 1：只建模 `a:outerShdw`，且只建模 canvas 能兑现的四项**

```ts
export interface OuterShadow {
  color: Color
  /** `a:outerShdw/@blurRad`，EMU。 */
  blurRadius?: number
  /** `@dist`，EMU。 */
  distance?: number
  /** `@dir`，1/60000 度，与渐变角同一套单位。 */
  direction?: number
}
```

canvas 只有 `shadowColor`/`shadowBlur`/`shadowOffsetX`/`shadowOffsetY`。`@sx`/`@sy`（阴影缩放）、`@kx`/`@ky`（倾斜）、`@algn`、`@rotWithShape` 都需要把形状再画一遍并施加矩阵，**不建模**；`a:innerShdw`、`a:glow`、`a:reflection`、`a:softEdge` 同理留在外面。

**决策 2：`dist` 与 `dir` 换成偏移是精确的，`blurRad` 换成 `shadowBlur` 是近似**

`offsetX = dist·cos(dir)`、`offsetY = dist·sin(dir)`，`dir` 的单位与 `a:lin/@ang` 相同（1/60000 度、屏幕空间顺时针），仓库已有那套换算。这一步没有猜。

`shadowBlur` 的规范定义是「σ = shadowBlur/2 的高斯模糊」，而 OOXML 的 `blurRad` 是一个半径，**两者的对应关系我无法从手头资料确认**（ECMA 的效果章节在本环境取不到）。因此取**恒等映射**：把 EMU 半径按页面映射换成 px 后直接交给 `shadowBlur`，并把「这是近似、不是规范换算」写进限制 —— 与 `a:miter/@lim`、`prstDash` 长度表同一条纪律。

**决策 3：一个形状只投一次阴影 —— 施加在第一次描画上**

canvas 的阴影是上下文状态，填充与描边各自都会投影，叠起来会在半透明填充下露出描边的那一层。因此阴影只施加在**第一次**描画（有填充就是填充，否则是描边），随后复位。这样画出来正好是形状轮廓的一次阴影，且不需要发明任何几何。

**形状的阴影不施加到它的文字上**：`a:outerShdw` 在 `spPr` 里描述的是形状，文字有自己的效果（未建模）。文本节点因此只在画路径时开阴影，画字之前复位。

**决策 4：写回完全不碰 `a:effectLst`**

本刀不加命令，模型值恒等于源值，而模型只表达 `a:outerShdw` 的四项 —— 若从模型重写该节点，源文件里的 `@sx`/`@kx`/`@algn` 与 `a:glow` 等兄弟节点就会被抹掉。**保持不碰**是唯一不损坏文件的选择，并有测试固定「改了别的东西时 `a:effectLst` 逐字不变」。无源生成则写出所建模的四项。

**决策 5：主题 `effectStyleLst` 与 `effectRef` 仍不解析**

与填充、线条两刀相同的分期：先做元素自己声明的，主题条目留给后续。因此靠样式库取阴影的形状本刀仍不投影。

## 4. 契约（增量）

`@ppt4ai/model`：新增 `OuterShadow`；`ShapeElement`/`TextElement` 新增 `shadow?`；`ResolvedShadow`（颜色已解析）供场景使用；进 `validateDocument`。

`@ppt4ai/pptx-import`：`spPr/a:effectLst/a:outerShdw` 的四项进模型，非法值局部忽略。

`@ppt4ai/render`：两种节点透传 `shadow`，颜色经主题解析为 `ResolvedShadow`。

`@ppt4ai/editor`：`paintShapeNode` 与 `paintPathFills` 在第一次描画前设置阴影、之后复位；偏移与模糊都乘页面缩放。

`@ppt4ai/pptx-export`：`serializeShapeXml` 在 `a:ln` 之后写 `a:effectLst`；写回不产生任何 effect 相关 replacement。

## 5. 测试策略

- **导入**：四项各自进模型；缺省时字段缺席；`a:glow` 等其他效果不产生 `shadow`；非法 `dir`/`blurRad` 忽略
- **模型**：颜色缺失、数值非整数/负数被拒
- **场景**：两种节点透传，颜色经 scheme 解析
- **绘制**：`shadowColor`/`shadowBlur`/`shadowOffsetX`/`shadowOffsetY` 按映射设置；只投一次（第二次描画前已复位）；文字不带阴影；无阴影时上下文被显式复位（防止上一个元素泄漏）
- **导出**：standalone 写出并能重新导入；源包改 bounds 时 `a:effectLst` 逐字不变；未编辑逐字节不变
- **回归**：现有 1482 项

## 6. 已知限制

- `blurRad` → `shadowBlur` 是近似（决策 2），厚模糊的视觉半径可能与 PowerPoint 不同
- `@sx`/`@sy`/`@kx`/`@ky`/`@algn`/`@rotWithShape` 不建模，因此拉伸或倾斜的阴影画成未变形的那一份
- `a:innerShdw`/`a:glow`/`a:reflection`/`a:softEdge` 仍不建模
- 主题 `effectStyleLst` 与 `effectRef` 仍不解析（决策 5）
- 表格、图片、幻灯片背景的效果不建模；文字自身的效果（`a:rPr/a:effectLst`）不建模
- 无命令与控件，只读

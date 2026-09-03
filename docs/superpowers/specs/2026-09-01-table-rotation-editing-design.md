# Table 旋转编辑设计

> 状态：✅ 已实现（2026-09-01，提交 fbde8ac, 859bf25）
> 日期：2026-09-01

## 1. 目标

让用户能在画布上旋转 table 元素，补上旋转链路最后一个未接通编辑入口的元素类型。

上一切片（实现提交 `46b41a6`）已把 table 旋转打通到模型、导入、写回、standalone 序列化、绘制与命中六处，但**刻意没有做 UI 入口**：`selectedRotatableNode` 不含 table，engine 的 `setElementRotation` 对 table 抛错。因此导入的旋转表格能正确显示与命中，界面上却无法新产生。

本切片补齐入口，并处理一个上一切片未触及的真实问题：**单元格编辑覆盖层不认识旋转**。

## 2. 当前基础

逐一读码确认，非推断：

- **模型与格式层已就绪**：`TableElement.rotation` 已存在，`validateDocument` 已含 table 的整数校验；导入 `parseRotation`、写回 `rotationReplacements`、standalone `attrs([['rot', ...]])` 均已接通。
- **渲染与命中已就绪**：`createTableNode` 透传 `transform`，`paintTableNode` 以映射后 bounds 为支点套 `withRotation`，`containsRotated`（`packages/editor/src/slide-canvas.ts:20`）已对 table 生效。
- **缺口一在 engine**：`setElementRotation` 的 `next.kind !== 'shape' && next.kind !== 'text'` 判断（`packages/engine/src/index.ts:1183`）把 table 挡在外面。
- **缺口二在 editor**：`selectedRotatableNode`（`packages/editor/src/PptEditor.vue:122`）只认 shape / text / image。
- **缺口三（本切片新发现）在单元格覆盖层**：`createTableEditorOverlay`（`packages/editor/src/table-editor-overlay.ts:45`）用未旋转 bounds 生成轴对齐 DOM 矩形，`tableCellAtPoint` 也做轴对齐判定。表格一旦旋转，绘制出来的表格与可点击的单元格区域会错位。
- **缺口四在 playground**：`rotateSelectedElement`（`apps/playground/src/asset-host.ts:255`）自己有一层 `kind !== 'shape' && kind !== 'text'` 守卫，会在 engine 之前就拒掉 table。**注意该守卫也排除了 image**（image 走单独的 `rotateSelectedImage` 路径），放宽时只加 table，不要顺手加 image 而改变既有分工。

## 3. 范围

**做**：

- engine `setElementRotation` 接受 table
- `selectedRotatableNode` 纳入 table，旋转手势、预览、overlay 角度与工具栏旋转按钮一并生效
- 单元格编辑覆盖层跟随旋转：容器套 CSS `rotate`，命中判定先把点反旋回本地坐标
- playground `asset-host.ts` 的 `rotateSelectedElement` 放宽 kind 守卫（见缺口四）

**不做**（明确延期）：

- table 的翻转 —— `flipH` / `flipV` 仍是 image 专属
- 多选与 group 的整体旋转 —— 需复合变换，与既有延期项一致
- 旋转元素的贴合选择框 —— 沿用既有已知限制
- 行列尺寸的拖拽手柄 —— 读码确认当前并不存在此手势（行列增删走 `insertTableRow` / `deleteTableRow` 等结构化命令，无拖拽手柄），故本切片无需处理

## 4. 关键决策

**决策 1：放宽 engine 判断而非新增命令**

把 `setElementRotation` 的 kind 白名单从 `shape | text` 扩到含 `table`，落点仍是裸 `rotation` 字段 —— table 与 shape / text 在模型层同构（都是裸字段，都无 `ElementTransform`），无需分派。零值删字段、不做 modulo 归一化、相同输入不增 history 全部沿用既有约定。

代价：`engine.test.ts:381` 有一条断言 table **不可**旋转，必须改写为可旋转。这是有意翻转一条既有契约，会在里程碑中显式记录，避免读者以为是回归。

**决策 2：覆盖层用 CSS transform，不重算每个单元格的四角**

覆盖层是 DOM，不是 canvas。给外层容器加 `transform: rotate(...)` 并设 `transform-origin: center`，内部单元格的 `left/top/width/height` 一律不动 —— 浏览器会连带旋转所有子元素，视觉上自动与 canvas 绘制对齐（canvas 侧同样绕中心旋转）。

替代方案是给每个单元格算旋转后的四点多边形，用 `clip-path` 或 SVG 渲染。否决理由：单元格数量可观，逐个重算不仅代码复杂，还会让 `cellStyle` 从简单矩形退化为多边形，`focus:ring` 等既有样式全部失效。

**决策 3：命中判定反旋点，与 canvas 命中同源**

`tableCellAtPoint` 收到的是屏幕坐标，容器旋转后该点不再落在轴对齐 rect 内。做法与 `containsRotated` 一致：以覆盖层 bounds 中心为支点，把点按负角度旋回本地坐标，再走既有 `pointInRect`。

**不把 `containsRotated` 提取到共享模块**：它在 `slide-canvas.ts` 里是私有函数，消费的是 EMU 空间的 `Rect`；覆盖层消费的是屏幕空间的 `{x,y,width,height}`。两者坐标空间与矩形类型都不同，强行共享需要引入适配层。按仓库既有风格（`rotation-transform.ts` 只抽真正逐字重复的绘制包装），这里在 `table-editor-overlay.ts` 内写一个同构的局部函数，注释说明与 `containsRotated` 的对应关系。

**决策 4：角度进入 overlay model，而非由组件读 props**

`createTableEditorOverlay` 的返回值增加 `rotation: number`（无旋转时为 `0`）。理由：`tableCellAtPoint` 只拿 model，不拿 node；若角度只存在于组件里，纯函数的命中判定就拿不到它，测试也无法脱离组件覆盖该逻辑。

## 5. Engine 命令契约（增量）

```ts
{ type: 'setElementRotation'; elementId: string; rotation: number }
```

- 新增接受 `kind === 'table'`，落点 `element.rotation`，语义与 shape / text 逐字相同
- 仍拒绝其余 kind（如 group、image 之外的未来类型），错误文案 `element cannot be rotated: <id>` 不变
- table 的 `layout`、`columns`、`rows`、`cells` 及单元格内容必须原样保留
- 旋转不影响 `tableCellSelection` 等编辑态

## 6. 组件契约（增量）

- `selectedRotatableNode` 增加 `node.kind === 'table'`；table 走 `emit('rotate-element', ...)` 分支（非 image 分支），无需新 event
- `createTableEditorOverlay(table, transform)` 返回值增加 `rotation`
- `TableEditorOverlay.vue` 容器样式增加 `transform: rotate(<deg>)` 与 `transform-origin: center`，`rotation === 0` 时不输出 transform（避免给未旋转表格引入新的合成层与样式差异）

## 7. 测试策略

先写测试再实现：

- **engine**：table 旋转落在裸字段；layout 与单元格内容保留；零值删字段；undo/redo 往返；改写既有「table 不可旋转」断言
- **overlay 纯函数**：model 带出 `rotation`；旋转后 `tableCellAtPoint` 对旋转过的屏幕点命中正确单元格，对旋转前的同一点不再命中；未旋转时行为逐字不变
- **overlay 组件**：容器渲染出 `rotate(...)`；未旋转时不含 transform
- **editor**：table 单选时出现旋转手柄，手势结束发 `rotate-element`

## 8. 已知限制

- table 不支持翻转
- 多选与 group 无法整体旋转
- 覆盖层旋转依赖 CSS transform，与 canvas 绘制的舍入可能有亚像素差异
- 单元格内文本自身不做二次旋转（文本随整表旋转）

> **2026-09-02 更正（两处）**
>
> 1. 原列「旋转表格的选择框仍是轴对齐外框」——**该条不成立**。`SelectionOverlay.vue:88,100` 对 border 与 frame 均施加 `transform: rotate(...)`，手柄作为 frame 子元素随之旋转。此错误源自 `2026-09-01-general-rotation-design.md` 决策 3（只读了 `selection-overlay.ts` 未读 `.vue`），已在该文件更正。真实缺口只剩多选联合 bounds 仍按轴对齐计算。
> 2. 末条原写「这与 PowerPoint 行为一致」——未经核实的断言，本机无阅读器可验证，已删除该援引；「文本随整表旋转」本身是本实现的事实描述，保留。

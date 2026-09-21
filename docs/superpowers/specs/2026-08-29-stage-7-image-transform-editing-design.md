# 阶段 7 图片旋转、翻转与中心缩放设计

> 状态：已确认，进入实施计划
> 日期：2026-08-29

## 目标

在现有图片资产、图片渲染和画布缩放基础上，补齐图片的用户编辑变换：旋转、水平/垂直翻转，以及带 Alt 修饰键的中心缩放。变换继续以 `Ppt4aiDocument` 为唯一事实来源，预览状态只存在于编辑器交互层，正常结束后由宿主通过一个 engine command 提交。

## 当前基础与边界

当前 `@ppt4ai/model` 已有图片专用的 `ElementTransform`，使用 OOXML 的六万分之一度整数表示 `rotation`，并使用 `flipH`/`flipV` 表示局部水平和垂直翻转。图片 Canvas painter 已围绕图片中心执行这些变换；engine 尚没有对应的编辑命令。

本切片明确保持图片专用边界：

- 不把 `ElementTransform` 扩展到 shape、text 或 table。
- 不给 group 增加变换矩阵，也不实现 group 或多选的旋转/翻转。
- 中心缩放复用现有单选、多选和 group 的 bounds 命令；它不改变对象类型或层级。
- 不在旋转手势中修改文档或读取 `AssetAdapter`。
- 不改现有 PPTX 导入、SceneGraph 或图片 painter；现有图片外观字段继续由它们负责。
- 本切片不写回已存在 PPTX 图片的 `a:xfrm`；源 package 变换写回作为独立导出切片。
- 不引入 Element Plus 或任何新的运行时依赖。

## 分层方案

采用“editor 计算手势、engine 提交语义、Playground 负责宿主同步”的边界：

1. `SelectionOverlay` 只报告指针位置和修饰键，维护 pointer capture，不读取文档。
2. `PptEditor` 根据图片 bounds 和当前变换计算旋转/缩放预览，管理手势取消，并在结束时发出 typed event。
3. `EditorEngine` 只接受 clone-safe 的最终角度、翻转轴或 bounds，生成单一 patch history。
4. Playground 将 editor event 映射为 engine command，刷新受控 `scene` 和 selection。

旋转预览只旋转选择框和旋转手柄，不创建临时文档快照或 renderer override；pointerup 后的受控 scene 刷新才改变图片像素。这与现有 resize 的边框预览语义一致，并避免异步 Canvas 渲染和手势状态产生竞态。

## Engine 命令契约

`EngineCommand` 增加两个图片专用变体：

```ts
type ImageFlipAxis = 'horizontal' | 'vertical'

{ type: 'setImageRotation'; elementId: string; rotation: number }
{ type: 'toggleImageFlip'; elementId: string; axis: ImageFlipAxis }
```

### `setImageRotation`

- `rotation` 必须是有限整数，单位为 OOXML `1/60000` 度；正值在 Canvas/CSS 坐标系中顺时针。
- 命令只接受 `kind: 'image'` 的元素，保留 bounds、assetId、crop、mask 和 effects。
- 角度按调用方提供的整数保存，不在 engine 内做 modulo 归一化，以避免重复旋转和已有负角度产生不可见的数值改写。
- 当角度为零且没有有效翻转时，规范化结果删除空的 `transform` 对象；相同语义的输入不增加 history。

### `toggleImageFlip`

- `horizontal` 切换 `flipH`，`vertical` 切换 `flipV`。
- `false` 字段不持久化；关闭最后一个翻转且没有旋转时删除 `transform` 对象。
- 旋转、另一方向翻转及所有图片外观字段保持不变。

两个命令都在校验目标文档后再 `commit`，一次命令最多增加一条 undo history。缺失元素、非图片、非法角度或非法轴均在 commit 前抛出稳定错误，不改变文档、selection、guides 或 history。undo/redo 恢复完整的 transform 对象，并且返回值通过 `structuredClone`。

## 中心缩放几何

扩展现有 `ResizeOptions`：

```ts
interface ResizeOptions {
  minWidth?: number
  minHeight?: number
  center?: boolean
}
```

`resizeBounds` 和 `resizeBoundsWithAspectRatio` 保持现有签名和固定对边默认行为；当 `center: true` 时，活动边从起始中心向两侧对称移动：

- edge handle 只在自己的轴上对称扩大/缩小，另一轴保持原尺寸和中心；
- corner handle 两轴都围绕同一中心变化；
- 指针越过中心时不允许翻转对象，改为夹到最小尺寸；
- `minWidth`/`minHeight` 仍是最终尺寸约束；
- corner + `center` + aspect lock 使用起始纵横比，并保持中心不变；edge 即使同时按 Shift 仍只做单轴缩放。

`ResizePointerPayload` 增加始终存在的 `altKey: boolean`。PptEditor 在每个 pointer event 上读取当前值，而不是只记住 pointerdown 的值，因此用户可以在手势中切换 Alt/Shift。现有调用方读取 `handle`、`point` 和 `shiftKey` 的代码保持可用。

缩放吸附函数增加 `centered?: boolean`：吸附仍针对活动边和现有候选优先级，但应用 delta 后重新围绕起始中心计算尺寸。比例锁定时只采用一个主轴 guide，再推导另一轴；未采用的轴不显示 guide。关闭 centered 时，现有吸附结果完全不变。

## 旋转几何

新增无 DOM 的纯函数，用于 editor 和测试共享：

```ts
rotationFromPointer(
  startRotation: number,
  center: Point,
  startPoint: Point,
  currentPoint: Point,
  shiftKey?: boolean,
): number
```

实现规则：

1. 以图片中心为圆心，计算起始指针和当前指针的屏幕角度。
2. 屏幕坐标的正角度视为顺时针，与 Canvas/CSS 和 OOXML 语义一致。
3. 对跨越 `-π/π` 的连续手势做角度展开，避免旋转手柄经过边界时跳变。
4. 将增量转换为 `1/60000` 度并四舍五入为整数。
5. Shift 按下时，将最终绝对角度吸附到 `900000`（15°）的倍数；不按 Shift 时不吸附。

起始点或当前点非有限时函数抛出稳定错误。pointerup 使用与 preview 完全相同的函数和起始快照，避免最后一帧漂移。

## SelectionOverlay 契约

保留现有八个 resize handle，并增加：

- `rotation?: number`：以 OOXML 单位传入，组件转换为 CSS 度数；
- `showRotationHandle?: boolean`：默认关闭；
- `rotate-start`、`rotate`、`rotate-end`、`rotate-cancel` 事件，payload 为 `{ point: Point; shiftKey: boolean }`。

激活且启用旋转时，组件在上边中点外绘制连接线和一个带 `data-selection-rotation-handle` 标记的 button。边框、resize handles、连接线和旋转手柄使用同一个 center-origin CSS rotation；旋转手柄自身不改变 pointer capture 语义。所有 resize/rotate 事件都只携带 JSON-safe 的数值和布尔值。

PptEditor 仅当当前作用域恰好选择一个图片时启用旋转手柄和图片变换工具栏。图片已有旋转时，resize pointer 会先逆变换回未旋转的局部框，再调用中心/比例几何函数；翻转只影响像素方向，不镜像选择框的操作轴。group、空选区、多选和非图片选择不显示图片旋转/翻转控件。

## PptEditor 与宿主事件

PptEditor 增加：

```ts
'rotate-image': [payload: { elementId: string; rotation: number }]
'flip-image': [payload: { elementId: string; axis: ImageFlipAxis }]
```

工具栏提供 UnoCSS 原生 button：旋转左 90°、旋转右 90°、水平翻转和垂直翻转。按钮只对单图选择启用，旋转按钮沿用当前角度生成绝对目标角度，翻转按钮发出轴向 intent。中英文 aria-label、按钮文本和成功/失败状态均纳入 i18n。

Playground 增加对应的 `rotateSelectedImage` 与 `toggleSelectedImageFlip` 宿主方法。方法验证当前目标仍为图片后 dispatch 一个 command；成功设置本地化成功状态，失败映射为现有 `element-operation-failed`，不产生额外 selection history。resize gesture 仍由已有 `resize`/`resizeSelection` 方法处理，Alt 只影响 editor 计算出的最终 bounds。

## 状态与取消规则

- rotate/resize preview 只保存 gesture start 的 element ID、bounds、transform、pointer 和修饰键快照。
- scene、selection、zoom 或作用域改变时立即清除 preview，不发提交 event。
- pointercancel 和组件卸载只清理本地状态，不调用 engine。
- pointerup 重新计算最终值；无变化时由 engine no-op，不增加 history。
- 任何宿主 dispatch 失败都保留原受控文档和选择框状态。

## 测试与验收

### 纯函数与组件

- 中心 edge/corner 缩放的中心不变、最小尺寸、Shift 比例和 Alt+Shift 组合；默认非 centered 行为不回归。
- centered resize snapping 的活动边、单轴/比例 guide、阈值和旧模式兼容。
- 旋转角度顺/逆时针、跨 ±180°、15°吸附、整数舍入和非法点。
- SelectionOverlay 的旋转手柄可见性、CSS rotation、pointer capture 和 rotate/resize modifier payload。

### Engine 与 Playground

- 图片旋转只改 transform.rotation，翻转只切换对应轴，其他外观字段保持不变。
- 非图片/非法输入原子失败；零值规范化、no-op、undo/redo、selection 保持和 clone safety。
- Playground 变换按钮各产生一个 command/history，不重复选择，不吞掉错误。

### 集成验收

- PptEditor 单图显示旋转手柄，旋转 preview 和 pointerup payload 一致；多选、group、非图片隐藏图片控件。
- 已旋转图片的 Alt resize 仍保持局部几何正确，普通图片 resize 和现有多选/group resize 不回归。
- `pnpm` 聚焦测试、全仓测试、`check:boundaries`、递归 typecheck、build、Element Plus 扫描和 `git diff --check` 全部通过。

## 后续切片

以下内容不由本设计隐式承诺：已存在 PPTX 图片的 `a:xfrm` 源包写回、旋转内容的实时 Canvas preview、shape/text/table 通用 transform、group/多选旋转、裁剪编辑、旋转吸附以外的高级变换，以及键盘微调。

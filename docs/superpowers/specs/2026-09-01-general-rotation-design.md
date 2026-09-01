# 通用旋转渲染设计

**日期**：2026-09-01 · **阶段**：阶段 6 · **状态**：待批准

## 1. 目标

让 shape / text 的 `rotation` 真正渲染出来，并修正旋转元素的命中测试。当前模型与 pptx 往返都已支持旋转，只有画布和交互层丢了它。

## 2. 现状：三个已用测试固定的缺口

**缺口 1 —— shape / text 旋转不进 scene graph。** `ShapeElement.rotation` / `TextElement.rotation` 字段存在，导入与导出（`standalone-xml.ts:338`、`writeback.ts:190`、`master-layout-writeback.ts:309`）均支持，但 `scenegraph.ts` 的 `createShapeNode` / `createTextNode` 不读该字段。固定于 `packages/render/src/rotation-gap.test.ts`。

**缺口 2 —— image 旋转透传但待遇不一致。** image 的 `transform` 会进 scene graph（`scenegraph.ts:235`）并由 `editor/src/image-painting.ts:74-95` 实际绘制（save → translate 到中心 → rotate → 画 → restore，`rotation` 单位为 1/60000 度）。同一份旋转数据，image 有绘制、shape/text 没有。

**缺口 3 —— 命中测试完全忽略旋转，image 的点选本来就是错的。** `slide-canvas.ts` 的 `hitTestScene` 用 `contains(bounds, point)` 做轴对齐矩形判断，不含任何旋转处理。实测一个旋转 90° 的 200×100 图片：点 `(590,500)`（旋转后为空白）会命中，点 `(500,560)`（旋转后图片实际覆盖）却选不中。固定于 `packages/editor/src/rotation-hit-test.test.ts`。

`selection-overlay.ts` 同样不含旋转处理，选择框在旋转元素上会与实际图形错位。

## 3. 范围

**做**：

- scene graph 为 shape / text 节点带上旋转，与 image 的 `transform` 统一为同一表示
- shape / text 绘制时套用旋转变换，复用 image 已验证的中心旋转约定
- 命中测试把点反向旋转到元素本地坐标后再判断，修正含 image 在内的所有旋转元素
- 更新 §2 三个 characterization test：它们当前固定的是「缺陷行为」，实现后必须改为断言正确行为

**不做**（明确延期）：

- table 旋转（`TableElement` 无 `rotation` 字段，需先扩模型与导入导出，独立切片）
- 旋转编辑手势对 shape / text 的扩展（image 已有 `image-transform.ts`；本切片只做渲染与命中，不加手势）
- 选择框在旋转元素上的视觉对齐 —— 见 §4 决策 3
- group 内旋转叠加（父组旋转 × 子元素旋转的复合变换）

## 4. 关键决策

**决策 1：scene 节点统一用 `transform`，不给 shape / text 单独加 `rotation`**

image 节点已用 `transform?: ElementTransform`。若 shape / text 用裸 `rotation`，绘制与命中测试都要分两套分支。因此 scene 层统一为 `transform`，由 `createShapeNode` / `createTextNode` 把模型的 `rotation` 包装成 `{ rotation }`。

模型层**不动** —— `ShapeElement.rotation` 保持原样，因为导入导出已依赖它，改模型会波及格式层。转换只发生在 scene 构建这一处。已知代价：模型与 scene 表示不同构，需在 `scenegraph.ts` 里显式转换。

**决策 2：旋转中心固定为 bounds 中心**

复用 `image-painting.ts:76` 已验证的约定（`translate(x + w/2, y + h/2)`），与 OOXML 的 `a:xfrm/@rot` 语义一致。不引入可配置旋转锚点。

**决策 3：本切片不修选择框视觉对齐**

`selection-overlay.ts` 无旋转处理，旋转元素的选择框会是外接的轴对齐矩形而非贴合图形。这在 PowerPoint 里是贴合的，但修它要连带改 8 个 resize 手柄的位置与拖拽方向映射，范围显著大于渲染与命中。

本切片先让「画得对、点得中」，选择框保持轴对齐外框 —— 这仍比现状好（现状是画都不画）。作为已知限制记录，后续独立切片处理。

**决策 4：命中测试反向旋转点，而非计算旋转后的包围盒**

两种做法：把点反向旋转回元素本地坐标后与原 bounds 比较，或计算旋转后的四角包围盒再判断。前者精确（旋转矩形的真实覆盖区域），后者会把角落空白也算作命中。选前者。

实现为 `slide-canvas.ts` 内的局部辅助函数，`contains()` 调用点改为先按节点 `transform.rotation` 反向旋转。`flipH` / `flipV` 不影响矩形覆盖区域，命中测试忽略它们。

## 5. 组件契约

**`packages/render/src/scenegraph.ts`**

```ts
export interface SceneShapeNode {
  // ...既有字段
  transform?: ElementTransform
}
export interface SceneTextNode {
  // ...既有字段
  transform?: ElementTransform
}
```

`createShapeNode` / `createTextNode` 在 `element.rotation` 非空且非 0 时设 `transform: { rotation }`。为 0 或缺省时不设该字段，保持既有快照稳定。

**`packages/editor/src/shape-painting.ts` / `text-painting.ts`**

`paintShapeNode` / `paintTextNode` 在节点带旋转时套用与 image 相同的变换。抽一个共享辅助函数放在新文件 `rotation-transform.ts`，避免三处重复：

```ts
export function withRotation(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  bounds: Rect,
  transform: ElementTransform | undefined,
  draw: () => void,
): void
```

`image-painting.ts` 暂不改用该辅助函数 —— 它还叠加了 mask、effects、crop，重构它超出本切片；仅在新代码里复用，避免动已验证的图片路径。

**`packages/editor/src/slide-canvas.ts`**

`hitTestScene` 签名不变。内部 `contains(bounds, point)` 的调用点改为按节点旋转反向变换后再比较。

## 6. 错误处理

- `rotation` 非有限数或非整数：`validateDocument` 已有校验，scene 层不重复防御
- 旋转为 0 或缺省：不设 `transform`，绘制与命中走原路径，零开销
- group 内元素的旋转：本切片按元素自身旋转独立处理，不做父子复合（§3 已列为不做）

## 7. 测试策略

TDD。§2 的三个 characterization test 需**改写为正确行为断言**，这是本切片的核心验证。

- `packages/render/src/rotation-gap.test.ts`：改为断言 shape / text 节点带 `transform: { rotation }`；0 与缺省时不带该字段
- `packages/editor/src/rotation-hit-test.test.ts`：改为断言旋转后点选正确 —— 旋转 90° 的 200×100 图片，`(500,560)` 命中、`(590,500)` 不命中
- `packages/editor/src/shape-painting.test.ts`、`text-painting.test.ts`：断言旋转时调用 `translate` / `rotate` / `restore`，未旋转时不调用
- `packages/editor/src/rotation-transform.test.ts`：辅助函数在异常抛出时仍 `restore`（`try/finally`）

**门禁**：全仓 `pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm check:boundaries`、Element Plus 扫描、`git diff --check`。因既有偶发失败未定位，全量测试须单独保存输出（`pnpm test > log 2>&1`）而非在管道里 tail。

## 8. 验收标准

1. shape / text 的非零 `rotation` 出现在 scene graph 的 `transform` 中；0 与缺省不出现
2. 旋转的 shape / text 在 Canvas 上真的转了（绘制调用序列可断言）
3. 旋转元素的点选与实际覆盖区域一致，含此前错误的 image 情形
4. 未旋转元素的绘制调用与命中结果与改动前一致（无回归）
5. pptx 往返不受影响：模型层未改，导入导出行为不变
6. 全部门禁通过

**不在验收范围**：table 旋转、旋转手势、选择框贴合旋转图形、group 复合旋转。

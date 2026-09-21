# Shape 与 Text 旋转编辑设计

> 状态：已确认（2026-09-01）
> 日期：2026-09-01

## 1. 目标

让用户能在画布上旋转 shape 与 text 元素。渲染与命中测试已由 `2026-09-01-general-rotation-design.md` 打通，持久化也已就绪，唯独缺少产生旋转的编辑入口 —— 目前旋转手柄与工具栏按钮只对 image 生效。

本切片补齐这最后一段：engine 增加通用旋转命令，editor 把已有的旋转手势从 image 专属泛化到 shape / text。

## 2. 当前基础

三层的实际状态（已逐一读码确认，非推断）：

- **模型层已就绪，不需改动**：`ShapeElement.rotation` 与 `TextElement.rotation` 已存在（`packages/model/src/index.ts:258,290`），并已有整数校验（`packages/model/src/index.ts:1099`）。
- **持久化已就绪，不需改动**：源包写回走 `rotationReplacements`（`packages/pptx-export/src/writeback.ts:840,847`），standalone 序列化走 `serializeShapeTransform`（`packages/pptx-export/src/standalone-xml.ts:213`）。
- **渲染与命中已就绪**：上一切片已让 scene 层把模型 `rotation` 包装为 `transform`，绘制与命中测试统一处理。
- **缺口在 engine 与 editor**：engine 只有 `setImageRotation`，且对非 image 元素硬性抛错（`packages/engine/src/index.ts:1162`）；`PptEditor.vue` 的 `rotationStart` 只读 `selectedImageNode`，结束时发 `rotate-image`（`packages/editor/src/PptEditor.vue:448,489`）。

结论：这是一个纯粹的「接通编辑入口」切片，不触碰模型与格式层。

## 3. 范围

**做**：

- engine 增加 `setElementRotation`，接受 shape / text / image
- `PptEditor` 的旋转手势与工具栏旋转按钮泛化到 shape / text
- editor 发出通用的 `rotate-element` event，playground 映射为新命令
- 旋转预览对 shape / text 生效，语义与 image 现有预览一致

**不做**（明确延期）：

- table 旋转 —— `TableElement` 无 `rotation` 字段，需先扩模型与格式层，独立切片
- shape / text 的翻转 —— `flipH` / `flipV` 仍是 image 专属，模型层不为 shape / text 引入
- 多选与 group 的整体旋转 —— 需要复合变换，见决策 4
- ~~选择框在旋转元素上的视觉对齐~~ —— 该项是误判，选择框本就随元素旋转，见 §8 更正

## 4. 关键决策

**决策 1：新增 `setElementRotation`，保留 `setImageRotation`**

不改 `setImageRotation` 的签名或行为，新增一个通用命令。理由：`setImageRotation` 写的是 `element.transform.rotation`（嵌套在 `ElementTransform` 内），而 shape / text 写的是 `element.rotation`（裸字段）。两者落点不同，硬塞进一个命令会让内部出现 kind 分支且校验路径分叉。

新命令按元素 kind 分派落点：image 走 `transform.rotation` 并复用 `normalizeImageTransform`，shape / text 直接写 `rotation`。对 image 而言两个命令等价，`setImageRotation` 保留以免破坏既有调用方与测试。

**决策 2：模型层不统一为 `ElementTransform`**

把 shape / text 也改成 `ElementTransform` 会更整齐，但会波及导入、两条导出路径与既有校验，范围远超本切片，且会引入 shape 是否支持 flip 的新语义问题。沿用上一切片的判断：模型层保持原样，差异吸收在 engine 的分派与 scene 构建两处。

**决策 3：零值归一化与 image 保持一致**

`rotation === 0` 时删除字段而非存 `0`，与 `normalizeImageTransform` 的既有约定一致，避免导出时产生无意义的 `rot="0"` 属性。相同语义的输入不增加 undo history。

**决策 4：手势仅支持单选**

旋转手势沿用 `selectedElementIds.length === 1` 的前提。多选旋转需要绕公共中心旋转并重算各元素 bounds，属于复合变换，与本切片的「接通入口」目标不同量级。

## 5. Engine 命令契约

```ts
{ type: 'setElementRotation'; elementId: string; rotation: number }
```

- `rotation` 为有限整数，单位 OOXML `1/60000` 度，正值在 Canvas 坐标系中顺时针
- 只接受 `kind` 为 `shape`、`text`、`image` 的元素；其他 kind（含 `table`）抛稳定错误
- 不做 modulo 归一化，按调用方给的整数保存，避免已有负角度被不可见改写
- 保留元素其余所有字段：bounds、fill、stroke、body、以及 image 的 crop / mask / effects / flip
- 缺失元素、不支持的 kind、非整数角度均在 commit 前抛错，不改文档、selection、guides 或 history
- 一次命令最多一条 undo history；undo/redo 恢复原值，返回值经 `structuredClone`

## 6. 组件契约

`PptEditor` 新增 event，替代 image 专属路径在通用场景下的使用：

```ts
'rotate-element': [payload: { elementId: string; rotation: number }]
```

`rotate-image` 保留不动（image 工具栏的翻转与旋转按钮仍在用），但旋转手势改发 `rotate-element`，因为手势现在覆盖三种 kind。

手势内部把 `selectedImageNode` 换成 `selectedRotatableNode`：单选且节点 kind 属于 shape / text / image 时返回该节点，起始角度统一从 scene 节点的 `transform.rotation` 读取 —— 上一切片已保证三种 kind 在 scene 层同构，这是本切片能简洁泛化的前提。

## 7. 测试策略

先写测试再实现，覆盖三层：

- **engine**：新命令对 shape / text / image 各自的落点正确；零值删字段；table 与缺失元素抛错；undo/redo 往返；相同输入不增 history
- **editor**：旋转手势对 shape / text 产生预览并在 pointerup 发出 `rotate-element`；手势中途选择变化时取消
- **playground**：event 映射为 engine command 后文档实际更新

## 8. 已知限制

- table 无法旋转（模型层缺字段）
- 多选与 group 无法整体旋转
- shape / text 不支持翻转

> **2026-09-02 更正**：原列「旋转元素的选择框仍是轴对齐外框，非贴合图形」及第 3 节「选择框在旋转元素上的视觉对齐 —— 沿用上一切片的已知限制」**均不成立**。`SelectionOverlay.vue:88,100` 对 border 与 frame 都施加了 `transform: rotate(...)`，8 个手柄作为 frame 子元素随之旋转，`selection-overlay.test.ts:185` 一直在断言这一点。错误源头是 `2026-09-01-general-rotation-design.md` 决策 3 只读了纯几何的 `selection-overlay.ts`、没读 `.vue` 组件，此后被逐份文档沿用。真实缺口只剩多选：联合 bounds 仍按轴对齐计算，已含在「多选整体旋转」条目内。

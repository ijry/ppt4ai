# Group 旋转级联设计

> 状态：✅ 已实现（2026-09-01，提交 7a440f1）
> 日期：2026-09-01

## 1. 目标

让 group 元素可以旋转，且旋转能正确级联到全部后代（含嵌套 group）。

这是旋转链路最后一个未打通的元素类型。shape/text/image/table 四种 kind 已全部打通模型、导入、写回、渲染、命中与编辑入口；group 连 `rotation` 字段都还没有。

## 2. 当前基础

逐一读码确认：

- **模型层缺字段**：`GroupElement`（`packages/model/src/index.ts:236-241`）只有 `id`/`kind`/`bounds`/`childIds`，无 `rotation`；`validateDocument:1100` 的整数校验白名单是 `shape | text | table`。
- **engine 明确拒绝**：`setElementRotation`（`packages/engine/src/index.ts:1183`）的 kind 白名单不含 group，抛 `element cannot be rotated`。
- **scene 层把 group 拍平**：`createNode`（`scenegraph.ts:263`）对 group 返回 `undefined`，子元素被提升为顶层 `nodes`，group 只以 `SceneGroup` 元数据（`scenegraph.ts:16-22`，含 `bounds`/`childIds`/`ancestorIds`/`paintOrder`）残留。**没有任何地方合成变换**。
- **命中测试对 group 硬编码无旋转**：`slide-canvas.ts:43,64` 两处均写 `rotation: undefined as number | undefined`。
- **几何已就绪**：上一切片把旋转数学收敛到 `@ppt4ai/geometry`，`rotatePointAround` 可直接复用。

## 3. 范围

**做**：

- `GroupElement.rotation` 字段 + `validateDocument` 白名单纳入 group
- engine `setElementRotation` 接受 group
- scene 构建时把祖先 group 的旋转级联进每个后代节点，并给 `SceneGroup` 带上生效旋转
- 命中测试改用 `SceneGroup.rotation`，去掉两处硬编码
- `selectedRotatableNode` 纳入 group（顺带让既有的「旋转下 resize 手势补偿」对 group 生效）

**不做**（明确延期）：

- **导入 `p:grpSp`** —— 导入器（`importer.ts:474`）只匹配 `sp`/`graphicFrame`/`pic` 并递归穿过 `grpSp`，因此**导入的分组会被拍平成散元素，`GroupElement` 只由编辑器 group 命令产生**。本切片的 group 旋转因此**不具备 PPTX 往返能力**，这是范围内已知的、有意接受的限制。
- **写回 group** —— `writeback.ts:461` 同样只扫三种 tag，且元素按位置索引一对一映射（`:815-825`），引入 group 元素会移位并触发 `element prefix mismatch`。
- `a:chOff`/`a:chExt` 子坐标空间 —— 全仓无任何读取（grep 零命中）。
- 多选整体旋转 —— 沿用既有延期项（原文此处并列的「旋转元素的贴合选择框」是误判，见 §6 更正）。

## 4. 关键决策

**决策 1：级联在 scene 构建期做，模型只存自身旋转**

模型里每个元素的 `bounds` 与 `rotation` 都是「未受祖先影响」的原始值，级联只发生在 `documentToSceneGraph` 一处。

好处不止是改动小 —— 它让 **group 缩放不产生斜切**：engine 的 `resize` 用轴对齐 `mapBounds` 缩放后代（`engine/src/index.ts:910-933`），若 bounds 里烘焙了旋转，缩放就会把矩形拉成平行四边形；把旋转留在渲染期，等价于「在 group 的未旋转本地空间里缩放，再整体旋转」，这样后代始终保持矩形。

> **2026-09-02 更正**：原文此处结尾写「这正是 PowerPoint 的语义」，属未经核实的断言 —— 本机无 PowerPoint/LibreOffice，无法验证另一应用行为。上述「不产生斜切」是可从代码与几何推出的性质，与 PowerPoint 无关，故保留；对 PowerPoint 的援引已删。

**决策 2：级联公式 —— 中心绕祖先支点旋转，角度相加**

后代节点 `bounds`（轴对齐、中心 `C`）、自身旋转 `r`，位于旋转 `R`、中心 `C_g` 的 group 内：

- 新中心 `C' = rotatePointAround(C, C_g, R)`
- 新旋转 `r' = r + R`
- 宽高不变

这是**精确等价**而非近似：把一个已旋转的矩形绕外部一点旋转，得到的仍是同尺寸的旋转矩形。因此级联不会引入形变。

**决策 3：嵌套时从内向外折叠**

group A（旋转 `R_A`、中心 `C_A`）内含 group B（`R_B`、`C_B`）内含元素 X。语义是 B 先把自己的内容绕 `C_B` 转，再由 A 把整体绕 `C_A` 转。

`appendElement` 是外→内递归，所以把祖先 `{支点, 角度}` 按外→内顺序累积成数组，**在叶子处反向遍历**（内→外）折叠。关键点：折叠时用的支点必须是**祖先未受更外层影响的原始中心** —— 因为内层先作用，此刻外层尚未移动任何东西。

**决策 4：`SceneGroup` 增加 `rotation`，命中测试直接消费**

`SceneGroup.rotation` 存的是**生效旋转**（自身 + 全部祖先），与后代节点同源。命中测试把两处 `rotation: undefined` 换成 `group.rotation`，`containsRotatedPoint` 已能处理。

嵌套 group 的 `bounds` 中心同样要被祖先旋转搬移，与后代节点走同一条折叠逻辑。

**决策 5：级联折叠函数放 `@ppt4ai/geometry`**

上一切片刚把旋转数学收敛到该包，级联是 `rotatePointAround` 的天然伙伴，且是纯数学、无依赖。新增 `cascadeRotation(bounds, rotation, ancestors)` 返回 `{ bounds, rotation }`。

## 5. 契约（增量）

```ts
// @ppt4ai/model
export interface GroupElement {
  // ...既有字段
  rotation?: number
}

// @ppt4ai/geometry
export interface RotationPivot { pivot: GeometryPoint; rotation: number }
export function cascadeRotation(
  bounds: GeometryBounds,
  rotation: number | undefined,
  ancestors: readonly RotationPivot[],
): { bounds: GeometryBounds; rotation: number }

// @ppt4ai/render
export interface SceneGroup {
  // ...既有字段
  rotation?: number
}
```

- `ancestors` 为空且自身无旋转时，`bounds` 按值返回、`rotation` 为 `0`，调用方据此省略 `transform`，既有快照不变
- engine `setElementRotation` 对 group 落点为裸 `rotation` 字段，零值删字段，与其余三种 kind 逐字相同

## 6. 已知限制

- **group 旋转不进 PPTX**：导入不认 `p:grpSp`、写回不处理 group（见 §3），因此旋转的 group 存不进文件，重新导入后分组本身也不存在
- **ungroup 会丢失 group 旋转**：后代存的是自身旋转，不含祖先贡献；解组后 group 的那份旋转无处可去。本切片**用测试固定该行为**使其可见，不做烘焙（烘焙需同时重算 bounds，属独立切片）
- 多选整体旋转仍未做
- group 自身不支持翻转

> **2026-09-02 更正与后续**
>
> - 本节原列「旋转元素的贴合选择框仍未做」（§3 亦有同样表述）**不成立**：`SelectionOverlay.vue:88,100` 已对 border 与 frame 施加 `transform: rotate(...)`，手柄随 frame 旋转。错误源头见 `2026-09-01-general-rotation-design.md` 决策 3 的更正。剩余只是多选联合 bounds 按轴对齐计算，已含在「多选整体旋转」内。
> - 前两条限制已在后续切片解除：`p:grpSp` 导入/写回（提交 `fba0b03`、`5c3bd72`、`be12a9e`）、ungroup 烘焙整棵子树（提交 `57a9e0f`）。

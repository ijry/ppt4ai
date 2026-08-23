# 阶段 7 Group 画布交互设计

## 目标

让现有 group 模型成为画布上的单一可操作对象：用户点击组内任意可见后代时选中最外层 group，显示组边框与八个缩放控制点，并可整体移动和缩放。这个切片复用现有扁平 SceneGraph 绘制协议，不实现进入组或直接编辑组内元素。

## 范围

包含：

- SceneGraph 增加 clone-safe 的 group 交互元数据。
- group 级命中、选择边框、拖拽移动和八方向缩放。
- 嵌套 group 递归变换全部叶子后代，并同步每层 group bounds。
- 每次 group 移动或缩放只创建一个 engine undo 事务。
- Playground 接通 group 选择、移动和缩放的宿主回写。

不包含：

- 双击进入组、组内子元素选择或文本编辑。
- group 自身的 painter、缩略图节点或新的绘制协议。
- 旋转、保持纵横比、中心缩放、吸附或多选组合变换。
- group/ungroup 工具栏入口；现有 engine 命令保持可用。

## SceneGraph 元数据

`SceneGraph.nodes` 继续只保存可绘制的 shape、text、table 和 image 节点，并保持现有扁平绘制顺序。新增 `groups` 数组，每项包含：

- `id`：group 元素 ID。
- `bounds`：group 当前 bounds。
- `childIds`：直接子元素 ID，保持模型顺序。
- `ancestorIds`：从最外层到直接父 group 的 ID，用于判定可交互顶层 group。
- `paintOrder`：该 group 最后一个可绘制后代在 `nodes` 中的顺序，用于重叠命中排序。

`documentToSceneGraph` 遍历 group 时仍递归展开叶子节点，同时记录 group 元数据。只把没有 group 祖先的 group 作为画布直接交互目标；嵌套 group 元数据仍保留，供递归关系、调试和后续进入组能力使用。所有字段只含普通对象、数组、字符串和数字，必须通过 `structuredClone`。

## 命中与选择

命中测试先按 `paintOrder` 从高到低检查顶层 group bounds；同一绘制顺序时，后出现的 group 优先。命中任一顶层 group 后返回 group ID，不再返回其叶子后代。未命中 group 时，再按现有反向 `nodes` 顺序命中普通节点。

这种规则保证 group 成为一个不可穿透的交互对象，同时不把不可绘制 group 伪装成 SceneNode。`PptEditor` 查找选择 bounds 时先查 `groups`，再查 `nodes`；因此组复用现有 SelectionOverlay，无需新增 Vue 控件。

## Engine 变换

`move` 保持现有选择命令语义。普通元素只移动自身；group 则递归收集 group 自身、所有嵌套 group 和全部叶子后代，把每个 bounds 同步平移。去重后一次生成一个 patch，因此一次 dispatch 只增加一个 undo 深度。

`resize` 继续接收目标元素 ID 和新 bounds。普通元素行为不变。group 的变换以旧 group bounds 为源坐标系：

- `scaleX = next.w / previous.w`
- `scaleY = next.h / previous.h`
- 每个后代 bounds 的左右边相对旧 group 左边按 `scaleX` 映射。
- 每个后代 bounds 的上下边相对旧 group 上边按 `scaleY` 映射。
- group 自身 bounds 精确使用命令传入的新 bounds；嵌套 group 使用同一映射公式。

模型校验已经拒绝零宽高 group 和循环引用，因此递归变换不需要恢复非法文档。若命令目标不存在，保持现有 no-op 语义。

## Vue 与 Playground 数据流

`SlideCanvas` 仍只发出命中 ID 和拖拽增量。`PptEditor` 不区分普通节点与 group，只依据 SceneGraph 交互 bounds 渲染选择框并发出移动或缩放事件。双击 group 不进入文本编辑，因为 `activate` 只接受 `nodes` 中的 text 节点。

Playground host 继续先选择事件目标，再 dispatch `move`；group ID 因而自然走递归移动。resize 直接 dispatch group ID 与新 bounds。engine snapshot 重建 SceneGraph 后，画布和选择框从新 group bounds 更新。

## 测试与验收

- render：group 元数据保留层级、顺序和 clone-safe 特性，`nodes` 绘制顺序不变。
- editor：组内点击返回顶层 group；普通节点和重叠 z-order 行为不回归；选择框读取 group bounds。
- engine：普通、嵌套 group 移动和非等比缩放正确；一次命令只增加一个 undo 深度；undo/redo 完整恢复。
- Playground：group ID 可选择、移动和缩放，并从 snapshot 观察后代与历史变化。
- 全量运行 typecheck、unit tests、build、boundary check、Element Plus 扫描和 `git diff --check`。

## 后续

进入组、组内编辑、group/ungroup UI、旋转与复杂组合变换保留为后续独立切片。本切片不预留 DOM 状态或不可 clone 的回调。

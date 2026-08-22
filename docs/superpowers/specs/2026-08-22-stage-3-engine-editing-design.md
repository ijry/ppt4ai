# Stage 3 Engine Editing Design

## Goal

建立零 UI、Node 可测试的编辑交互核心：文档会话、命令总线、选择、多选变换、网格和元素吸附、撤销重做、z 序以及扁平组合。

## Scope

本阶段只操作 JSON-safe 模型中的 EMU `bounds`，并保证所有文档写操作都通过 `EditorEngine.dispatch(command)` 进入。选择状态和吸附参考线属于 engine 会话状态，不写回文档；文档修改以可逆 patch 记录，历史不保存全量快照。

本阶段包括：

- 单选、替换选择和 additive 多选
- 对选中元素移动、对单个元素设置正值 bounds
- 网格吸附，以及未选元素的左边缘、中心线、右边缘吸附
- undo/redo
- bring-to-front、send-to-back、bring-forward、send-backward
- group/ungroup；group 是扁平元素，持有 `childIds`，渲染时递归展开

本阶段不包括旋转、复杂路径命中测试、文本排版、图片处理和 UI 手柄；这些能力继续由后续阶段负责。

## Model Changes

`Element` 增加：

```ts
interface GroupElement {
  id: string
  kind: 'group'
  bounds: Rect
  childIds: string[]
}
```

group 自身进入 slide 的 z-order，children 保留在扁平 `document.elements` 中但不再直接出现在 slide 的 `elementIds`。`documentToSceneGraph` 递归展开 group，输出 children 的原有顺序。engine 计算 group bounds 为所有后代元素 bounds 的并集。

## Command and Patch Contracts

`@ppt4ai/engine` 暴露 `EditorEngine`、`EngineCommand`、`EngineState`、`Patch` 和吸附类型。命令至少包含 `select`、`move`、`resize`、`undo`、`redo`、`zOrder`、`group`、`ungroup`。`dispatch` 返回当前状态的 JSON-safe 副本。

patch 使用路径和显式 presence 标记，避免用 `undefined` 破坏 JSON-safe：

```ts
type PatchValue =
  | { present: false }
  | { present: true; value: JsonValue }

interface PatchOperation {
  path: string[]
  before: PatchValue
  after: PatchValue
}
```

一个 command 生成一个 patch 事务；undo 应用逆序 patch，redo 应用正序 patch。新的文档写 command 会清空 redo 栈。无文档变化的 select 不进入历史。

## Selection and Snapping

selection 是去重且保持选择顺序的 element ID 数组。move 对选择集使用同一个 delta，先求选择集 bounds，再按确定性优先级寻找吸附：元素边缘/中心，随后网格；每个轴最多产生一个 `SnapGuide`。只有候选距离不超过 threshold 才吸附。吸附结果和 guides 在 `EngineState` 中可直接断言。

## Invariants

- 所有写操作都经过 command；engine 不暴露可变 document 引用。
- `bounds.w` 和 `bounds.h` 始终大于 0。
- slide、元素、group child 引用保持有效且不重复。
- group 不允许循环引用；ungroup 恢复 children 在 group 原位置的顺序。
- `structuredClone(engine.getState())` 与状态相等。

## Verification

Vitest 在 Node 环境验证命令结果、patch 历史、吸附 guides、z-order、group/ungroup 和 SceneGraph 展开。完成阶段后运行包边界检查、全量测试、类型检查和构建。

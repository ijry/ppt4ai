# 阶段 7 Group 进入与组内选择设计

## 目标

在现有顶层 group 选择、移动和缩放之上，增加最小可用的组内编辑入口：双击 group 进入当前 group，上下文内点击直接子元素，Escape 逐层退出。文档模型、SceneGraph 绘制顺序和 engine 变换命令保持不变。

## 交互状态

`PptEditor` 持有 `groupPath: string[]`，表示从最外层到当前编辑上下文 group 的 ID。该状态只包含字符串数组，可安全复制。路径失效或 scene 更新后不再存在时自动截断到仍有效的前缀。

- 空路径：命中顶层 group 或未分组节点。
- 路径非空：当前 group 自身作为上下文边界；命中只返回当前 group 的直接子 group 或直接叶子节点。
- 双击当前命中的 group：进入该 group，并保持其作为选中元素。
- 双击文本叶子：复用现有文本编辑事件。
- Escape：退出一层路径并选中父 group；空路径时不产生事件。
- 点击当前上下文外：退出全部路径，再按顶层规则重新命中；空白处清空选择。

## 命中规则

`hitTestScene(scene, point, groupPath?)` 保持第三个参数可选以兼容现有调用。非空路径时，根据 `ancestorIds` 精确筛选当前 group 的直接子 group，并从叶子节点中排除不属于当前 group 或属于更深 group 的节点。绘制仍使用完整扁平 `nodes`，只有交互目标过滤发生变化。

## 事件与职责

`SlideCanvas` 接收 `groupPath`，在 select/activate 时使用上下文命中函数；新增 `enter-group` 事件只携带 group ID，Escape 由 `PptEditor` 处理。拖拽和 resize payload 继续使用实际选中元素 ID，因此组内叶子自然复用现有 engine 变换和文本编辑链路。

`PptEditor` 将 group 双击转换为 `enter-group`，不触发文本 activate；进入后更新本地路径并选中 group。普通节点双击仍只触发既有 activate。选择变化不会制造 engine history。

## 不包含

- group/ungroup toolbar、旋转、保持比例、中心缩放和多选组合变换。
- 组内浮动层级面板、面包屑 UI、跨 slide 组路径持久化。
- group 专用 painter；缩略图继续按扁平叶子顺序绘制。

## 验收

- hit-test 在空路径选顶层 group，在路径内选直接子叶子或嵌套 group。
- 双击 group 进入并将后续点击路由到直接子对象。
- Escape 逐层退出，失效路径被清理，点击上下文外回到顶层。
- 普通节点选择、拖拽、缩放和文本双击行为不回归。
- 所有 editor 状态、事件 payload 与 SceneGraph 可 `structuredClone`。

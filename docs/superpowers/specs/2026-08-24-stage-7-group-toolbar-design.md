# 阶段 7 Group/Ungroup 工具栏交互设计

## 目标

为现有 group/ungroup engine 命令提供可见、可访问的编辑器入口，并补齐受控多选、组合选区边框和整组选区拖拽语义。这个切片只处理顶层对象，不改变已完成的 group 进入模式、绘制协议或 engine 事务模型。

## 范围

包含：

- `PptEditor` 增加受控多选输入和选择变化事件，同时保持现有单选 API 兼容。
- 画布支持普通点击替换选择，Shift/Ctrl/Meta 点击切换顶层对象的选择成员关系，空白点击清空选择。
- 多选时显示一个覆盖全部已选顶层对象的联合边框，不显示缩放控制点。
- 拖动已选成员时保留完整多选并移动整个 engine selection。
- 编辑器工具栏增加原生 Group 和 Ungroup 按钮，只使用 UnoCSS 样式。
- Playground 宿主接通多选、group、ungroup 和整组选区移动命令。
- 为新增按钮补齐 Vue-I18n 文案、禁用状态、焦点状态和可测试标记。

不包含：

- 进入 group 后在组内进行多选、group 或 ungroup。
- 多选缩放、旋转、吸附、保持纵横比或中心缩放。
- group/ungroup 键盘快捷键、右键菜单或浮动快捷工具条。
- group-local selection 的持久化、跨层级组合或嵌套 group 重排。
- chart、页面导航或新的第三方 UI 框架。

## 受控选择 API

`PptEditor` 新增可选 prop：

- `selectedElementIds?: string[]`：按 engine selection 顺序提供当前顶层选择。

现有 `selectedElementId?: string` 保留。选择来源按以下优先级归一化：

1. 如果调用方显式传入 `selectedElementIds`，使用其中存在于当前可交互层级的 ID，并去重但保持原顺序。
2. 否则，如果 `selectedElementId` 有值，归一化为单元素数组。
3. 否则为空选择。

`PptEditor` 新增事件：

- `selection-change`，payload 为 `{ elementIds: string[] }`。

现有 `select` 事件继续发出，用于兼容旧宿主：

- 新选择恰好一个对象时，发出该对象 ID。
- 新选择为空或包含多个对象时，发出 `undefined`。

所有由画布点击、空白点击、进入/退出 group 或文本激活产生的选择变化，都先发出 `selection-change`，再按上述兼容规则发出 `select`。受控组件不在内部长期持有顶层选择；最终显示状态仍由 props 决定。

## 选择意图与修饰键

`SlideCanvas` 的选择事件扩展为 clone-safe payload：

- `nodeId?: string`：命中目标；空白为 `undefined`。
- `toggle: boolean`：Shift、Ctrl 或 Meta 任一按下时为 `true`。

画布仍使用现有 group-aware 命中测试。`PptEditor` 根据当前受控选择处理意图：

- `toggle = false` 且命中对象：选择只包含该对象。
- `toggle = false` 且命中空白：清空选择。
- `toggle = true` 且命中未选对象：把对象追加到选择末尾。
- `toggle = true` 且命中已选对象：从选择中移除该对象。
- `toggle = true` 且命中空白：保持当前选择不变。

这个切片只允许当前顶层作用域中的直接对象进入多选。未进入 group 时，可选对象为无 group 祖先的普通节点和顶层 group；已进入 group 时继续沿用现有单选交互，并禁用多选切换和 group/ungroup 命令。

## 选择边框

单选继续使用现有 `SelectionOverlay`：

- 普通节点使用 `SceneGraph.nodes` 中的 bounds。
- group 使用 `SceneGraph.groups` 中的 bounds。
- 显示边框和八个缩放控制点。

多选使用所有已选顶层对象 bounds 的联合矩形：

- `left = min(x)`，`top = min(y)`。
- `right = max(x + w)`，`bottom = max(y + h)`。
- 联合 bounds 为 `{ x: left, y: top, w: right - left, h: bottom - top }`。
- group 和普通叶节点以相同方式参与联合计算。
- 找不到 bounds 的失效 ID 被忽略；若最终没有有效 bounds，则不显示边框。
- 多选只显示联合边框，不显示八个 resize handle，也不允许开始 resize gesture。

联合边框沿用现有 EMU-to-CSS 映射和选区视觉样式，不新增独立的 DOM 坐标体系。

## 拖拽语义

拖拽开始时，`PptEditor` 判断命中对象是否已经属于当前归一化选择：

- 已属于选择：保持当前选择，发出既有 move 事件；宿主直接对完整 engine selection 执行 move。
- 不属于选择：先把选择替换为该对象，再开始单对象移动。

Playground 的 `moveSelected` 不再无条件 dispatch 单元素 `select`。它只在拖拽目标不属于当前 engine selection 时替换选择，然后 dispatch `{ type: 'move', dx, dy }`。因此多选拖拽仍是一个 engine move 事务，并保持现有 undo/redo 原子性。

进入 group 后继续使用当前组内的单对象拖拽语义；这个切片不让组内拖拽隐式创建跨层级多选。

## 工具栏

在编辑器现有内容区顶部增加一个轻量对象工具栏。工具栏使用原生语义元素和 UnoCSS utility class：

- 容器使用水平布局、细分隔线和白色背景，不使用阴影或新的设计系统。
- Group 和 Ungroup 均使用 `<button type="button">`。
- 每个按钮有可见的 hover、active、disabled 和 `focus-visible` 状态。
- 颜色与边框过渡控制在 150–200ms，并尊重浏览器 disabled 语义。
- 按钮通过 Vue-I18n 提供可见文案和 `aria-label`，不使用仅图标表达。

按钮可用条件：

- Group：当前未进入 group，且至少选中两个有效顶层对象。
- Ungroup：当前未进入 group，且恰好选中一个顶层 group。
- 其他情况按钮 disabled。

点击 Group 时发出 `group` 事件，无 payload。点击 Ungroup 时发出 `ungroup` 事件，payload 为 `{ groupId: string }`。`PptEditor` 不直接依赖 engine；Playground 宿主分别 dispatch `{ type: 'group' }` 和 `{ type: 'ungroup', groupId }`。

engine 现有命令语义保持不变：group 成功后 selection 变为新 group ID；ungroup 成功后 selection 变为原 group 的直接 children ID 列表。宿主刷新 snapshot 后，受控 props 自动显示新的单选或多选边框。

## Group 进入模式兼容

`groupPath` 非空时视为处于进入模式：

- Group 和 Ungroup 按钮保持可见但 disabled，避免工具栏跳动。
- Ctrl/Meta/Shift 点击不扩展组内选择。
- 组内已有单选、文本编辑、Escape 退出和双击进入行为保持不变。
- 退出最外层 group 后，工具栏根据宿主传入的顶层 selection 重新计算状态。

如果 scene 更新导致当前 `groupPath` 失效，继续使用现有路径归一化；工具栏状态随归一化结果同步恢复。

## Playground 宿主接线

Playground 从 `engineState.selection` 派生 `selectedElementIds`，并继续派生仅在长度为一时有值的 `selectedElementId`，以覆盖新旧 API 兼容测试。

宿主新增或调整以下方法：

- `selectElements(elementIds)`：dispatch 单次 `{ type: 'select', elementIds }` 并刷新 snapshot。
- `selectElement(elementId)`：作为旧单选包装，委托给 `selectElements`。
- `moveSelected(elementId, dx, dy)`：仅在目标不在当前 selection 时先替换选择，再 dispatch move。
- `groupSelected()`：dispatch `{ type: 'group' }` 并刷新 snapshot。
- `ungroupSelected(groupId)`：dispatch `{ type: 'ungroup', groupId }` 并刷新 snapshot。

命令失败继续沿用现有宿主错误处理，不在 Vue 组件中吞掉 engine 结果或伪造 selection。

## 测试验收

- `SlideCanvas` 测试普通点击、Shift/Ctrl/Meta 点击和空白点击发出的选择意图。
- `PptEditor` 测试新旧受控选择 API、`selection-change` 与兼容 `select` 事件顺序、切换成员语义和空白语义。
- `PptEditor` 测试多选联合边框覆盖普通节点与 group，并确认多选没有 resize handles。
- `PptEditor` 测试拖动已选成员不清空多选，拖动未选对象先替换选择。
- 工具栏测试 Group/Ungroup 的启用矩阵、原生 disabled、focus 样式、i18n 文案和事件 payload。
- Playground 宿主测试多选 dispatch、整组选区 move、group 后选择新 group、ungroup 后选择 children，以及 undo/redo 深度保持原子命令语义。
- 现有 group 进入、文本编辑、单选 resize、缩略图和资产测试继续通过。
- 完成 editor/playground 定向测试、workspace source tests、类型检查、构建、边界检查、Element Plus 扫描和 `git diff --check`。

## 后续切片

这个切片完成后，再独立规划多选 resize、group 内组合命令、键盘快捷键、旋转与吸附。每个后续能力都继续复用 engine selection 和事务边界，不在本阶段预埋未使用协议。

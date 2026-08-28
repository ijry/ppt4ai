# 阶段 7 多选缩放、比例锁定与吸附设计

## 目标

在已完成的顶层受控多选、联合选区边框和整组选区拖拽基础上，让多个顶层对象可以通过联合框八个控制点原子缩放，并为四角缩放增加 Shift 保持纵横比和确定性的网格/对象吸附参考线。单选、group 进入模式和现有 engine 历史模型保持兼容。

## 当前基础

- `PptEditor` 已接收 `selectedElementIds`，多选时能计算顶层对象联合 bounds，但当前隐藏 resize handles。
- `SelectionOverlay` 已提供八方向 pointer gesture 和单选缩放预览。
- `EditorEngine` 已支持单元素/group `resize`、选择集 `move`、移动吸附和单命令 patch history。
- group resize 已能递归映射所有嵌套 group 和叶子后代。
- Playground 仍是唯一 dispatch engine command 并刷新 snapshot 的宿主层。

## 范围

包含：

- 多选联合框显示八个 resize handles。
- 四个角 handle 在 Shift 按下时保持起始联合框纵横比。
- 多选缩放期间显示联合框预览，不修改受控选区。
- 活动边/角吸附到网格以及未选顶层对象的左/中/右、上/中/下参考位置。
- 缩放参考线使用现有 `SnapGuide` clone-safe 结构并映射到画布 overlay。
- engine 新增原子 `resizeSelection` command，把当前选择作为一个联合坐标系缩放。
- Playground 接通多选缩放并验证一次 gesture 只增加一个 undo depth。

不包含：

- Alt 中心缩放、旋转、翻转或倾斜。
- 进入 group 后的组内多选和组合变换。
- 移动过程中的实时对象预览或移动吸附参考线；现有 engine move snapping 保持不变。
- 同时按 Shift 与 Alt 的 PowerPoint 组合语义。
- 键盘微调、右键菜单、浮动快捷条、chart 或页面导航。
- Element Plus 或其他 UI 组件框架。

## 方案选择

采用“editor 负责手势预览与 resize 吸附，engine 负责原子文档变换”的分层方案。

不采用宿主逐个 dispatch 现有 `resize`：这会把联合坐标映射泄漏到 Playground，并为一次 gesture 产生多条 history。不采用临时 group 后 resize 再 ungroup：这会改变 ID、层级、z-order 和选区，并制造额外事务。

## Overlay 事件契约

`SelectionOverlay` 的 resize 事件统一使用：

`type ResizePointerPayload = { handle: SelectionHandle; point: Point; shiftKey: boolean }`

`resize-start`、`resize`、`resize-end` 和现有的 `resize-cancel` 都携带 pointer 当时的 Shift 状态；取消事件继续保留当前的 `handle`/`point` payload。现有调用方只读取 `handle` 和 `point` 时保持兼容。

多选只要归一化后至少包含两个有效顶层对象，就显示与单选相同的八个 handles。进入 group 后仍只允许当前组内单选缩放，不增加组内多选。

## 联合框缩放几何

gesture 开始时记录：

- 当前归一化 `elementIds`。
- 以 EMU 表示的起始联合 bounds。
- handle、pointer 起点和 handle 中心偏移。
- 起始纵横比 `start.w / start.h`。

普通缩放继续复用八方向固定对边语义：west/east 只移动左右边，north/south 只移动上下边，corner 同时移动两个轴。最小宽高等于当前 zoom 下 1 CSS px 对应的 EMU，禁止零或负尺寸。

Shift 只约束 `nw`、`ne`、`se`、`sw` 四个角：

1. 先按现有 `resizeBounds` 得到 raw bounds。
2. 比较宽高相对起始尺寸的变化量，变化更大的轴作为主轴。
3. 用起始纵横比从主轴推导另一轴尺寸。
4. 对角 handle 的相反角保持固定。
5. 四个边 handle 即使按 Shift 仍保持单轴缩放，不隐式引入中心缩放。

pointerup 使用与最后一次 preview 相同的纯几何函数重新计算，避免预览与提交漂移。

## Resize 吸附

`PptEditor` 新增可选 `snapOptions?: SnapOptions` prop，并复用 `@ppt4ai/engine` 已导出的 `SnapOptions` 和 `SnapGuide` 类型。未提供、`enabled = false` 或 threshold 非正值时不吸附。

吸附候选只来自当前顶层可交互作用域：

- 排除所有已选根对象。
- 选中 group 时同时排除其全部后代，避免吸附到正在变换的内容。
- 未选顶层 group 只贡献 group bounds，不重复贡献其叶子后代。
- 未分组顶层节点贡献自身 bounds。

每个候选 bounds 产生 X 轴 left/center/right 和 Y 轴 top/center/bottom。若配置 `gridSize`，活动边同时可吸附到最近网格线。候选必须在 `threshold` EMU 内。

非比例锁定时，corner 可在 X/Y 两轴各选择一条 guide，edge 只处理自身活动轴。每轴按以下顺序确定：

1. 绝对 delta 最小。
2. 距离相同优先 element，再选 grid。
3. 仍相同时按 scene 顶层交互顺序和 left/center/right 或 top/center/bottom 固定顺序。

Shift corner 为避免破坏比例，只采用一个主吸附轴：比较 X/Y 候选 delta 相对当前宽高的比例，选择较小者；完全相同时固定优先 X。应用该轴吸附后，再从起始比例推导另一轴，因此最终 bounds 仍严格保持比例，并只显示实际采用的 guide。

## 参考线显示

`PptEditor` 在 canvas 容器中渲染原生绝对定位 `div`：

- X guide 为贯穿画布高度的竖线。
- Y guide 为贯穿画布宽度的横线。
- EMU `position` 使用与 canvas/selection 相同的 zoom 映射。
- 使用 UnoCSS 蓝色细线、`pointer-events-none` 和 `data-snap-guide`/`data-snap-axis` 测试标记。
- gesture end/cancel、selection 改变、scene 失效或组件卸载时立即清空。

参考线只表示当前缩放 preview，不写入文档或 history。

## Engine 原子命令

`EngineCommand` 新增：

`{ type: 'resizeSelection'; bounds: Rect }`

执行规则：

1. 对当前 selection 去重、过滤无效 ID，并移除已被另一个所选 group 包含的后代 ID，得到不重叠的根选择。
2. 计算根选择 bounds 的联合矩形；空选择为 no-op。
3. 校验目标 bounds 有限且宽高为正。
4. 计算 `scaleX = target.w / source.w` 和 `scaleY = target.h / source.h`。
5. 收集每个根对象及其 group 后代，按 ID 去重。
6. 每个 bounds 相对 source 左上角做仿射映射：位置和宽高分别应用对应轴比例。
7. 一次 `commit` 写入全部 bounds patch，selection 保持原顺序，history 增加至多一层。

目标 bounds 与 source 完全相同则为 no-op，不增加 history。现有 `resize { elementId, bounds }` 保留，继续服务单选兼容调用方。

## PptEditor 与宿主事件

单选 resize 继续发出现有：

`resize: { elementId: string; bounds: Rect }`

多选 resize 新增：

`resize-selection: { elementIds: string[]; bounds: Rect }`

payload 中的 `elementIds` 使用 gesture start 时的归一化顺序。若 gesture 期间受控 selection 或 scene 改变，PptEditor 取消 preview，不发出提交事件。

Playground host 新增 `resizeSelected(elementIds, bounds)`：先用无 history 的 select command 同步目标选择，再 dispatch `resizeSelection`。成功后选区保持相同 ID 顺序；错误沿用现有 element operation failure 状态。

Playground 将 engine snap 配置作为只读 `snapOptions` 暴露并传给 `PptEditor`，确保 preview threshold/grid 与宿主配置一致。本切片的最终 resize bounds 已由 editor 决定，engine 不对 `resizeSelection` 二次吸附。

## 测试与验收

- selection geometry：四角 Shift 严格保持比例，固定对角不漂移；边 handle 的 Shift 仍是单轴；最小尺寸和 handle offset 不回归。
- resize snapping：对象优先级、网格 fallback、阈值、顶层 group 候选、已选 group 后代排除、Shift 单轴吸附均可纯函数断言。
- engine：普通多选、混合 group/叶子、嵌套 group、重复/失效 selection、no-op、非法 bounds、undo/redo 和 clone safety。
- editor：多选显示八个 handles；preview 联合框、Shift、guide、cancel、受控 selection 变化取消；单选 legacy resize 不回归。
- Playground：两个顶层对象一次缩放后按联合坐标同比例更新，一次 gesture 只增加一个 undo depth，undo 完整恢复。
- 运行聚焦测试、editor 源测试、全仓源测试、递归 typecheck、build、12 包边界检查、Element Plus 扫描和 `git diff --check`。

## 后续

移动过程的实时选区预览与吸附参考线、Alt 中心缩放、旋转、保持比例的键盘切换细节、组内多选和复杂组合变换继续作为独立切片处理。

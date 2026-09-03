# 形状 paint 控制器设计

> 状态：已实现（2026-09-03，待填）
> 日期：2026-09-03

## 1. 目标

给 `ShapePaintToolbar` 配一个 headless 控制器，把「当前选中元素 + 场景」变成工具栏的展示模型，并把四个 emit 转成 engine 命令。这是「命令 → headless 控制器 → `.vue`」三步的第二步。

## 2. 当前状态（实测）

`grep TableFormattingToolbar|TextFormattingToolbar` 在 `packages/` 与 `apps/` 里只命中 `index.ts` 的导出与自身的测试 —— **两个既有格式工具栏都从未被任何应用挂载**。只有 `ThemePanel` 走完了到 playground 的全程。

所以「像 ThemePanel 那样接线」是唯一有先例的路径，而不是「像其他工具栏那样」。本刀先做控制器；playground 接线是下一刀，与主题面板当初的两步一致。

## 3. 关键决策

**决策 1：色块显示**场景解析后的颜色**，不是元素自己的字段**

形状库那类形状 `spPr` 全空、填充来自 `fillRef`，元素自己没有 `fill`。若色块只读元素字段，它会显示一个默认色而屏幕上是蓝色 —— 用户看到的和工具栏说的不是一回事。

所以控制器取**场景节点的 `resolvedFillColor`/`resolvedStrokeColor`**，那正是画布画出来的颜色。**点它设的是直接 `fill`**（覆盖主题引用），这与 PowerPoint 一致，也是命令唯一能做的事。

**否决只读元素字段**：那对最常见的形状（形状库出品）恰好最不准。

**决策 2：渐变标记来自场景的 `resolvedFillGradient`/`resolvedStrokeGradient`**

同一条理由：渐变可能来自元素自己，也可能来自主题条目（`fillRef` 指向渐变条目）。场景已经把两种来源统一成一个字段，控制器读它即可，不需要自己判断来源。

**决策 3：宽度与线型读元素字段，不读场景**

`strokeWidth`/`strokeStyle` 在场景里已经融合了主题回退（`shapeStroke` 的逐属性 `?? 主题`）。工具栏该显示**生效值**，所以读场景节点的 `strokeWidth`/`strokeStyle` 同样正确 —— 与颜色一致。三者都读场景，规则统一。

**决策 4：只在恰好选中一个可承载 paint 的元素时 `active`**

多选与 `image`/`table`/`group` 都让工具栏禁用。命令是元素级的（`d3e7abf` 的已知限制），控制器不假装能做多选 —— 禁用是诚实的，静默只改第一个不是。

**决策 5：控制器不持有 scene，每次调用现算**

`ThemeEditorController` 的方法都从 `engine.getState()` 现读。这里同样：`props(scene)` 收一个 `SceneGraph` 参数，而不是在构造时捕获。否则 undo/redo 之后控制器会拿着过期的场景。

## 4. 契约（增量）

```ts
createShapePaintController({ engine }): {
  target(): string | undefined          // 唯一可编辑元素的 id
  props(scene: SceneGraph): ShapePaintToolbarProps
  setFill(fill: Fill | null): EngineState
  setStroke(stroke: Fill | null): EngineState
  setStrokeWidth(width: number | null): EngineState
  setStrokeStyle(style: StrokeStyle | null): EngineState
}
```

四个 setter 在没有可编辑目标时抛稳定错误。

## 5. 测试策略

- **target**：单选 shape/text 时返回 id；多选、无选、`image`/`table`/`group` 返回 `undefined`
- **props**：`active` 随 target 存在与否；颜色取自场景解析值（含来自 `fillRef` 的情况）；渐变标记取自场景渐变字段；宽度线型取生效值
- **setter**：四个各自 dispatch 对应命令并回传新状态；无目标时抛稳定错误
- **回归**：现有 1353 项测试

## 6. 已知限制

- 未接进 playground —— 独立一刀
- 无多选（决策 4）
- 工具栏点色块会把主题引用覆盖成直接填充，这是命令的语义，控制器不掩饰但也没有 UI 提示「你正在脱离主题」
- 场景里没有节点的元素（例如被 group 折叠掉的）取不到解析值，`props` 回落到元素自己的字段

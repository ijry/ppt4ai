# 形状 paint 工具栏设计

> 状态：已实现（2026-09-03，待填）
> 日期：2026-09-03

## 1. 目标

给形状与文本元素的填充、描边颜色、描边宽度、描边线型做一个工具栏。四条命令都已就绪（`270644a`、`d3e7abf`），写回也已就绪（`d93e36c`），所以 UI 是这条线的最后一段。

## 2. 当前状态（实测）

`packages/editor/src` 下有三个 headless 模块加对应 `.vue`：`table-formatting-toolbar.ts` / `TableFormattingToolbar.vue`、`text-formatting-toolbar.ts` / `TextFormattingToolbar.vue`、`theme-panel.ts` / `ThemePanel.vue`。

**没有任何形状级的 paint 工具栏** —— `grep` 在 `.vue` 里找 `strokeWidth`/`setElementFill` 零命中。四条命令只能从代码调用。

## 3. 关键决策

**决策 1：走既有三步，headless 模块只声明 props 与 emit 契约**

`table-formatting-toolbar.ts` 就是这个形状：一个 `Props` 接口、一个 `Emit` 类型，没有逻辑。控制器负责从文档算出展示模型，`.vue` 只渲染与转发。本刀照抄这个骨架，不发明第四种模式。

**决策 2：工具栏收「已解析的展示值」，不收元素**

props 是 `fillColor?: string`（hex）、`strokeColor?: string`、`strokeWidth: number`、`strokeStyle`，与 `TableFormattingToolbarProps` 逐项对应。**否决把 `Element` 传进组件**：那会让组件去理解 `Fill`、渐变、`styleRef` 回退与主题解析，而那些都是控制器与场景的职责。

**决策 3：渐变在工具栏上只显示为它的第一个停靠点，且标记出来**

一个渐变填充没有单一 hex 可显示。`fillIsGradient: boolean` 让组件能把色块标为渐变而不是谎称它是纯色。**点它会设一个纯色并丢掉渐变** —— 那正是命令的语义（决策 2 of `d3e7abf`），组件如实呈现这个后果。

**否决在工具栏里编辑渐变停靠点**：渐变编辑器是独立一刀，塞进颜色按钮只会做出一个两者都不像的控件。

**决策 4：宽度用 EMU 进出，磅只在显示层**

命令收 EMU（`a:ln/@w` 的单位）。工具栏显示磅（`12700 EMU = 1pt`），转换放在 headless 模块的两个纯函数里并加测试 —— 否则每个调用点都要自己乘 12700，迟早有一处写错。

**决策 5：`null` 由专门的清除动作发出，不靠「空字符串」**

四个属性都能清除（回到主题继承）。`emit('set-fill', null)` 与 `emit('set-fill', fill)` 是两个明确的调用，与 `ThemePanel` 的 `reset-color` 是同一条路子。**不把「输入框清空」当成清除信号** —— 那会让「正在输入」与「要清除」无法区分。

## 4. 契约（增量）

`shape-paint-toolbar.ts` 导出 `ShapePaintToolbarProps`、`ShapePaintToolbarEmit`、`pointsFromEmu`/`emuFromPoints`、`STROKE_STYLE_OPTIONS`。

`ShapePaintToolbar.vue` 渲染两个颜色输入、一个宽度输入、一个线型选择，各带清除按钮与 `aria-label`。

## 5. 测试策略

- **单位换算**：`12700 EMU` ↔ `1pt`；`0` 双向保持 `0`；非整数磅四舍五入到整数 EMU；负数与非数字回落到 `undefined`
- **组件**：四个控件按 props 显示当前值；改颜色 emit `Fill`；点清除 emit `null`；改宽度 emit EMU 整数；改线型 emit 三个词之一；渐变填充显示为渐变标记而非纯色
- **禁用态**：`active` 为 false 时全部禁用
- **回归**：现有 1336 项测试

## 6. 已知限制

- 工具栏未接进 `PptEditor` 与 playground —— 接线是独立一刀（主题面板走过同样两步：先组件、后 playground 接入）
- 无多选支持：命令是元素级的，工具栏也只作用于单个元素
- 渐变只显示不可编辑（决策 3）
- 描边宽度的磅值四舍五入到整数 EMU，所以 `0.75pt` 这类值往返后可能差 1 EMU —— 不可见，但记录在此

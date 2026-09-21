# 幻灯片背景渐变编辑控件设计

> 状态：已实现（2026-09-21）
> 日期：2026-09-21

## 1. 目标

`SlideBackgroundPanel` 此前只能"选纯色替换背景"。背景的渐变已能读取/解析/绘制/写回,但面板不能编辑。这一刀给面板加**两停靠点线性渐变编辑器**(起色/止色/角度)。

## 2. 关键决策

**决策 1：面板模型加 `gradientStart`/`gradientEnd`/`gradientAngle`,并加 `set-gradient` 事件**

`slideBackgroundModel` 从已解析的 `ResolvedGradient` 派生编辑器初值:起色=首停靠点、止色=末停靠点、角度=`angle/60000` 取模 360;无渐变时起色回落到平色、止色回落白、角度 0。新增 `backgroundGradientFrom(startHex, endHex, angleDegrees)` 构造两停靠点 `Fill`(拒非法 hex 与非有限角度,角度归一到 0..359 再换算 60000ths)。

**决策 2：面板加三个输入(两个色板 + 一个角度数字框)**

`SlideBackgroundPanel.vue` 的 `fieldset` 里三个输入各自 change 时读另两项当前值合成渐变发 `set-gradient`。控件带 `data-slide-background-gradient-*`。en/zh 加 `gradientEditor`/`gradientStart`/`gradientEnd`/`gradientAngle` 文案。

**决策 3：playground 接线**

`App.vue` 加 `setSlideBackgroundGradient(fill)` → `assetHost.setSlideBackground({ fill })`,面板 `@set-gradient` 接上。engine 的 `setSlideBackground` 与写回本就支持渐变 fill,因此端到端可用。

## 3. 测试策略（TDD）

- **模型**（`slide-background-panel.test.ts`,+4)：从渐变派生起色/止色/角度(90°);`backgroundGradientFrom` 构造 fill;角度绕回 0..359;拒非法输入。既有纯色 `toEqual` 补三个渐变字段。
- **组件**（`SlideBackgroundPanel.test.ts`,+2)：改渐变起色色板→发两停靠点 fill(角度 90°=5400000);无 slide 时渐变输入禁用。
- **回归**：全量 2453 项。

## 4. 已知限制

- 只做两停靠点线性渐变(起/止);多停靠点、径向、角度以外的 `scaled`/`fillToRect` 不在面板里编辑(能读能画能保,只是面板不造)。
- 面板仍不造图案/图片背景(各是后续独立控件)。

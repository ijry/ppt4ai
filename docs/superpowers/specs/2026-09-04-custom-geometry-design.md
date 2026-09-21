# 自定义几何（字面坐标）设计

> 状态：已实现（2026-09-04，`5c32012`）
> 日期：2026-09-04

## 1. 目标

让 `a:custGeom` 的路径真正画出来。今天 `a:custGeom` **一个字节都不读**：形状退回 `preset: 'rect'`，因此任何用任意多边形工具画的图形、任何 SmartArt 拆出来的图形、任何 logo 都渲染成矩形，而且**无源导出会把它写成 `<a:prstGeom prst="rect"/>`** —— 与本轮修掉的六处枚举收敛是同一类损坏，只是丢的不是一个词而是整条路径。

## 2. 探针结果（实测）

一个 `a:custGeom` 三角形（字面坐标）与一个用了 `a:gdLst` 公式引用的形状（`custgeom-probe.test.ts`，已删除）：

```
literal  : {"id":"el_1","kind":"shape","preset":"rect",…}          ← 路径全丢
guides   : {"id":"el_2","kind":"shape","preset":"rect",…}          ← 同样
standalone(literal): <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>   ← 由 preset 值推出，非另测
```

**两个都塌成矩形，无源导出写出的也是矩形。**

## 3. 关键决策

**决策 1：只做字面坐标，公式引用整条路径放弃**

`a:custGeom` 的坐标可以是数字（`x="1234"`），也可以是 guide 名（`x="adj1"`，配 `a:gdLst` 的 `fmla="*/ w 1 2"` 这类公式）。**公式表与 187 个预设的那张表同源、同样查不到**，因此：坐标全为数字时画出真实路径；**任何一个坐标不是数字，整个 `custGeom` 视为不可表达**，退回今天的行为（按 `preset` 画，通常是矩形）。半懂半猜的路径比矩形更糟 —— 它会把线条连到错误的位置。

**决策 2：命令建模五种，`a:arcTo` 换算成既有的 `arc`**

`a:path` 的子元素里，`moveTo`/`lnTo`/`cubicBezTo`/`quadBezTo`/`close` 直接对应 canvas 的五个调用。`arcTo` 给的是半径与起止角，而 `PathCommand` 的 `arc` 需要圆心 —— 圆心由**当前点**推出（`centre = current − (wR·cos(stAng), hR·sin(stAng))`），这是标准换算，不发明数值。因此 `PathCommand` 新增 `cubic` 与 `quad` 两种，`arc` 复用。

**决策 3：坐标空间按 `a:path/@w`/`@h` 映射到形状框**

`a:path` 声明自己的坐标空间（`w`/`h`），路径坐标是那个空间里的数。映射就是按比例缩放到 `bounds`。缺 `w`/`h` 时按 OOXML 语义直接用形状框坐标。多个 `a:path` 依次拼接（每个自带 `moveTo`），这是多子路径图形的表达方式。

**决策 4：standalone 写回 `a:custGeom`，不再退化成 `prstGeom`**

模型持有的是路径本身，因此按模型写出 `a:custGeom/a:pathLst/a:path` 是机械的。**源包写回继续不碰 `custGeom` 节点**（既有 `geometryReplacements` 对 `custGeom` 源只在模型 preset 变化时才动；custGeom 形状的 `preset` 保持 `rect`，因此比较相等、节点原样保留），并有测试固定。

**决策 5：`a:gdLst`/`a:avLst`/`a:cxnLst`/`a:rect` 不建模**

`gdLst` 是决策 1 放弃的那部分；`cxnLst`（连接点）与 `a:rect`（文本框区域）与绘制无关，本刀不读。

## 4. 契约（增量）

`@ppt4ai/geometry`：`PathCommand` 新增 `cubic`/`quad`；新增 `createCustomPath(geometry, bounds)`。

`@ppt4ai/model`：新增 `CustomGeometry` 与 `CustomGeometryCommand`；`ShapeElement`/`TextElement` 新增 `customGeometry?`；进 `validateDocument`。

`@ppt4ai/pptx-import`：`a:custGeom` 的字面路径进模型；含公式引用时字段缺席。

`@ppt4ai/render`：有 `customGeometry` 时用它建路径，否则仍走 `createPresetPath`。

`@ppt4ai/editor`：`tracePath` 支持 `cubic`/`quad`。

`@ppt4ai/pptx-export`：`serializeGeometry` 在有 `customGeometry` 时写 `a:custGeom`。

## 5. 测试策略

- **导入**：三角形字面路径进模型（含 `w`/`h`）；`cubicBezTo`/`quadBezTo`/`arcTo`/多子路径各一条；任一坐标是 guide 名时字段缺席
- **几何**：坐标从 path 空间映射到 bounds；`arcTo` 的圆心按当前点推出；空命令列表不产生路径
- **模型**：命令类型与数值校验
- **场景**：有自定义几何时节点路径来自它；没有时逐字不变
- **绘制**：`bezierCurveTo`/`quadraticCurveTo` 被调用
- **导出**：standalone 写出 `a:custGeom` 并能重新导入；源包未编辑逐字节不变、改 bounds 时 `custGeom` 逐字保留
- **回归**：现有 1615 项

## 6. 已知限制

- 用 guide 公式的 `a:custGeom` 仍按 `preset` 画（决策 1）：这是绝大多数 PowerPoint 内置形状的表达方式，因此本刀主要救的是「自由绘制/导入的路径」
- `a:gdLst`/`a:avLst`/`a:cxnLst`/`a:rect` 不建模（决策 5）
- 路径的 `@fill`/`@stroke`/`@extrusionOk` 属性不建模：所有子路径共用形状自己的填充与描边

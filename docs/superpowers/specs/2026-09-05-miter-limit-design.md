# 尖角限制（`a:miter/@lim`）

> 状态：待实现
> 日期：2026-09-05

## 1. 目标

让 `a:miter/@lim` 进入模型、**影响画布**、从无源导出写出。这是 `CT_LineProperties` 最后一处未建模的部分。

与前几刀不同的是：**这一个 canvas 能真画**（`context.miterLimit`），所以它是完整的一刀，不是「先存着、绘制留后」。

## 2. 探针结果（实测）

探针已删除。一个 `<a:ln w="76200">…<a:miter lim="800000"/></a:ln>` 走三条路：

| 路径 | 结果 |
|---|---|
| 导入后的模型 | `{…, strokeWidth: 76200, strokeJoin: "miter"}`——转角读到了，**`lim` 没读** |
| 源包写回（只改 bounds） | `<a:miter lim="800000"/>`——**原样保留** |
| 无源导出 | `<a:miter/>`——**限制值丢了**，只剩裸元素 |

与 `cmpd`/`algn`、可调值那几刀同一类：**无源导出改写了用户的文件**。

## 3. 关键决策

**决策 1：新增兄弟字段 `strokeMiterLimit?: number`，存 OOXML 的百分比原值**

```ts
/** `a:miter/@lim`, a percentage of the line width where 100000 is 100%. */
strokeMiterLimit?: number
```

与 `strokeWidth`（存 EMU 原值）同一惯例：模型存文件的单位，换算留给绘制层——这样导出不必反向换算、不引入浮点误差。

**决策 2：只在转角是 `miter` 时才有意义，但不强制**

`lim` 是 `a:miter` 的属性，所以文件里它只可能与 `strokeJoin: 'miter'` 同时出现。模型不加这条约束（校验只查数值合法性），理由与「允许 `cap` 与 `join` 共存」相同：校验拒绝合法数据的代价高于放过一个无意义组合。绘制层只在 `join === 'miter'` 时用它——canvas 的 `miterLimit` 对其他转角本就无效。

**决策 3：百分比 ÷ 100000 得到 canvas 的比值**

OOXML 的 `lim` 是**相对线宽的百分比**（`ST_PositivePercentage`，100000 = 100%）；canvas 的 `miterLimit` 是**尖角长度与线宽之比**。两者参照同一个长度，因此换算就是除以 100000：`lim="800000"` → `miterLimit = 8`。

canvas 的默认值是 10，对应 `lim="1000000"`。

**这一步是推理而非实测**：两边都说「相对线宽」，但「线宽」是否指全宽（而非半宽）我无法在此核实。换算方向与量级无疑，可能差一个 2 倍因子。列入阅读器核对清单，核对方法写清楚（画一个很尖的角，量它在什么线宽比例上被截断）。

**决策 4：非法值忽略而非报错**

`lim` 必须是正数。`0`、负数、非数字一律不进模型，与 `parseLineWidth` 的既有做法逐字相同。

## 4. 契约（增量）

`@ppt4ai/model`：`ShapeElement`/`TextElement` 各加 `strokeMiterLimit?: number`；`ThemeLineStyle` 加 `miterLimit?`（与 `cap`/`join`/`compound`/`align` 对称）；校验要求正数。

`@ppt4ai/pptx-import`：`parseStrokeMiterLimit(line)` 读 `a:miter/@lim`；元素两条路径与主题条目都读。

`@ppt4ai/render`：`SceneShapeNode`/`SceneTextNode` 各加字段，`shapeStroke` 逐属性回退。

`@ppt4ai/editor`：`canvasMiterLimit(limit)` 把百分比换成比值，`paintShapeNode` 与 `paintPathFills` 在设 `lineJoin` 之后设 `miterLimit`。**与 `lineCap`/`lineJoin` 一样必须无条件设置**——不设会把上一个元素的值留在 context 上。

`@ppt4ai/pptx-export`：standalone 的 `a:miter` 写出 `lim`；`themeLineStyleXml` 同步；writeback 新增一份 join 元素的属性补丁。

## 5. 验证

`packages/pptx-import/src/miter-limit.test.ts`：读出 `800000`；`<a:miter/>` 无属性时字段缺席；`0`/负数/非数字忽略；`a:round` 上不存在该属性；主题条目同样读出。

`packages/editor/src/miter-limit.test.ts`：`canvasMiterLimit(800000)` 为 `8`；缺席时为 canvas 默认 `10`；绘制时 `miterLimit` 落在 context 上；**转角不是 miter 时也设**（回到默认值，不残留上一个元素的）。

`packages/pptx-export/src/miter-limit.test.ts`：standalone 写出 `<a:miter lim="800000"/>`；缺席时写裸 `<a:miter/>`；往返逐字相等；writeback 无关编辑保持字节相同；writeback 改值、删值各写对。

`packages/model/src/miter-limit.test.ts`：正数通过，`0`/负数/非数字报出带路径的错误。

## 6. 已知限制

**参照长度未经核对**：换算假设 OOXML 与 canvas 的「线宽」指同一个长度。若实测差 2 倍，改一个常量即可。列入阅读器核对清单 2.7。

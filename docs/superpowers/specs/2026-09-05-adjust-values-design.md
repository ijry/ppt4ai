# 预设几何的可调值（`a:prstGeom/a:avLst`）

> 状态：待实现
> 日期：2026-09-05

## 1. 目标

让 `a:prstGeom/a:avLst` 的可调值进入模型并从无源导出写出，**不再把用户拖过调节柄的形状还原成默认形态**。

## 2. 探针结果（实测）

探针已删除。一个 `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom>` 走三条路：

| 路径 | 结果 |
|---|---|
| 导入后的模型 | `{id, kind, preset:"roundRect", bounds, fill}`——**没有可调值** |
| 源包写回（只改 bounds） | `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom>`——**原样保留** |
| 无源导出 | `<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>`——**可调值被换成空列表** |

`standalone-xml.ts:461` 写死了空的 `<a:avLst/>`，第 467 行的注释也明说「adjust values belong to the guide language the model does not read」。

损失只在无源路径，与 `cmpd`/`algn`、预设虚线词、预设几何词那几刀是同一类：**导出改写了用户的文件**。一个 25% 圆角变成默认圆角，不是渲染近似。

## 3. 关键决策

**决策 1：公式字符串逐字保存，不解析**

```ts
/** One `a:gd` of an `a:avLst`: the guide's name and its formula, both verbatim. */
export interface AdjustValue {
  /** `@name`, e.g. `adj`, `adj1`, `adj2`. */
  name: string
  /** `@fmla`, e.g. `val 25000`. Kept as written — see below. */
  formula: string
}
```

`a:avLst` 里的条目照惯例是 `val N`，但**我无法在此核实它一定是**：`a:gd/@fmla` 的语言有 `*/ a b c`、`pin`、`at2`、`cat2` 等十几种形式，而 `a:avLst` 与 `a:gdLst` 用的是同一个属性类型。

逐字保存因此是唯一不发明东西的做法：往返完全可逆，且将来要用它绘制时再解析 `val N`、并对其余形式明确记录处置。**先解析成数字会在遇到非 `val` 形式时静默丢失信息**，那正是这刀要修的毛病。

**决策 2：只读 `a:prstGeom` 的 `a:avLst`**

`a:custGeom` 也有 `a:avLst`，还有 `a:gdLst`。那些属于公式几何那一刀（更大、需要实现公式语言），本刀不碰——`parseCustomGeometry` 现在只吃字面坐标，给它半套引导值没有意义。

**决策 3：绘制不用它**

`roundRect` 的 `adj` 大概是圆角半径的比例，但「大概」不够：折算基准（半个短边？整个短边？）在此无法核实，猜错会让每个圆角矩形都变形。而**现在的行为是所有圆角矩形都用 `Math.min(w,h)/2`**，那已经是一个固定近似，本刀不让它变差也不假装变好。

这与预设多边形那刀的取舍一致：`hexagon` 的 `adj` 默认值同样不在名字里，已列入阅读器核对清单 2.6。**核对完 2.6 就同时拿到了这两处需要的折算基准**，届时是一刀「用可调值绘制」，本刀是它的前置。

**决策 4：空列表与缺席都不进模型**

`<a:avLst/>` 与根本没有 `a:avLst` 语义相同（都表示「用默认值」），因此都让 `adjustValues` 缺席。无源导出在缺席时继续写 `<a:avLst/>`——那是 Office 自己的写法，也是本刀之前的行为。

## 4. 契约（增量）

`@ppt4ai/model`：`AdjustValue` 接口；`ShapeElement`/`TextElement` 各加 `adjustValues?: AdjustValue[]`；校验要求 `name` 与 `formula` 都是非空字符串。

`@ppt4ai/pptx-import`：`parseAdjustValues(shape)` 读 `a:prstGeom/a:avLst/a:gd`，缺 `@name` 或 `@fmla` 的条目丢弃；元素两条路径都读。

`@ppt4ai/pptx-export`：`serializeGeometry` 接受可调值并写出 `<a:gd name="…" fmla="…"/>`；缺席时仍写 `<a:avLst/>`。

`@ppt4ai/render`、`@ppt4ai/editor`：**不改**。可调值不进场景图——没有消费者，加了就是死字段。

源包写回**不改**：它已经原样保留，且模型现在持有的值与源一致，不存在比较不等的风险。

## 5. 验证

`packages/pptx-import/src/adjust-values.test.ts`：
- 读单个 `adj`，读多个 `adj1`/`adj2`（顺序保持）
- 公式字符串逐字保存（含非 `val` 形式，如 `*/ 100000 w ss`）
- 缺 `@name` 或 `@fmla` 的条目丢弃
- `<a:avLst/>` 与无 `a:avLst` 都让字段缺席
- `a:custGeom` 的 `a:avLst` **不**被读进来（本刀边界）

`packages/pptx-export/src/adjust-values.test.ts`：
- standalone 写出 `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom>`
- 往返：多个可调值逐字回来
- 缺席时写空 `<a:avLst/>`
- **回归**：源包写回在只改 bounds 时保持字节相同

`packages/model/src/adjust-values.test.ts`：`name`/`formula` 空串或非字符串各自报错，错误带元素路径与条目下标。

## 6. 已知限制

**绘制仍不用可调值**：所有 `roundRect` 用同一个圆角半径，所有多边形画正多边形。要用它绘制需要先核对折算基准（阅读器核对清单 2.6），那是独立一刀。

**`a:custGeom` 的 `a:avLst`/`a:gdLst` 仍不建模**：属公式几何那一刀。

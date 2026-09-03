# 主题线条样式设计

> 状态：待实现（2026-09-03）
> 日期：2026-09-03

## 1. 目标

让 `a:lnStyleLst` 条目的 `w` 与 `prstDash` 进入模型，使只靠 `p:style/a:lnRef` 取轮廓的形状拿到真实粗细与线型。前两个切片（描边宽度、虚线描边）都在「已知限制」里点名了这处缺口，它是形状描边保真的最后一块。

## 2. 探针结果（实测）

主题 `lnStyleLst` 放三个真实 Office 风格的条目 —— 0.5pt 实线、1pt 虚线、1.5pt 点线；页上一个形状 `spPr` 全空，只有 `<p:style><a:lnRef idx="2">`：

```
element   : {"id":"el_1","kind":"shape","preset":"rect","bounds":{…},"styleRef":{"line":{"idx":2,"color":{"type":"scheme","v":"accent1"}}}}
lineStyles: [{"color":{"type":"scheme","v":"phClr"}},{"color":{"type":"scheme","v":"phClr"}},{"color":{"type":"scheme","v":"phClr"}}]
```

**三个条目逐字相同** —— 源里 `w="6350"/"12700"/"19050"` 与 `val="solid"/"dash"/"sysDot"` 全被丢掉，只剩 `phClr`。`importer.ts:210` 的注释本来就写着「A line entry wraps its fill in `a:ln`, which also carries the width we do not model」。

形状那侧：`styleRef.line` 只有 `idx` 与 `phClr` 的替换色，没有宽度也没有线型。场景图 `scenegraph.ts:277-278` 的 `strokeWidth`/`strokeStyle` 只从 `element` 自己的字段来，所以这个形状拿到颜色后仍按一像素实线画 —— 主题说 1pt 虚线，画布画 1px 实线。

## 3. 关键决策

**决策 1：只给线条条目加形状，`ThemeStyleEntry` 不动**

```ts
export interface ThemeLineStyle extends Fill {
  width?: number        // a:ln/@w，EMU
  style?: StrokeStyle   // a:ln/a:prstDash
}
export type ThemeLineStyleEntry = ThemeLineStyle | null
```

`ThemeStyleEntry = Fill | null` 保持原样 —— 填充与背景条目没有宽度可言，把宽度塞进公共类型只会让两类条目都声明自己有对方的属性。

**关键在于 `ThemeLineStyle` 是 `Fill` 的结构超集**，所以 `resolveStyleEntry`、`validateFill`、主题写回的颜色比较等等**每一处既有消费者读 `entry.color` 都不用改**。这与前两个切片「加兄弟字段而不重塑既有类型」是同一条决策，只是这次落在主题条目上。

**字段名取 `width`/`style` 而不是 `strokeWidth`/`strokeStyle`**：`TableBorder` 早就是 `{ color, width?, style? }`，两个「线条记录」读起来一致比与元素字段同名更重要。元素上的 `stroke`/`strokeWidth`/`strokeStyle` 与这个形状的统一，仍是描边宽度切片当初推迟的那个独立收敛切片。

**决策 2：逐属性回退，不整块回退**

```ts
const strokeWidth = element.strokeWidth ?? themeLine?.width
const strokeStyle = element.strokeStyle ?? themeLine?.style
```

OOXML 里 `spPr/a:ln` 与 `p:style/a:lnRef` **逐属性合并**：直接 `<a:ln>` 只覆盖它自己声明的那些。所以一个只写了 `<a:solidFill>`、没写 `w` 的直接轮廓，宽度仍应取主题的。**否决「有直接 `<a:ln>` 就整块忽略主题」** —— 那会让「只改轮廓颜色」这个最常见的编辑顺带把粗细打回发丝线。

这条与颜色已有的规则同源：`shapeStrokeColor` 用的就是 `直接 ?? 主题`。

**决策 3：新增 `resolveStyleLineStroke`，不改 `resolveStyleLine` 的签名**

`resolveStyleLine` 继续只返回 `ResolvedColor`（颜色要做 `phClr` 替换与颜色映射，与宽度线型无关），新函数只返回不需要解析的那两项：

```ts
export function resolveStyleLineStroke(reference, theme): { width?: number; style?: StrokeStyle } | undefined
```

**否决把 `resolveStyleLine` 改成返回聚合对象**：那要动它每个调用点，而聚合里颜色与另两项的解析路径本来就不同（颜色要 theme + colorMap，另两项只要索引）。`idx="0"` 是 OOXML 的「none」、列表 1 基这两条规则由两者共用的取条目辅助函数负责，不各写一遍。

**决策 4：条目为 `null` 时不给宽度**

渐变线条条目在模型里记 `null`（样式矩阵切片的决策），所以它的宽度也无处可取。**不为 `null` 条目发明宽度** —— 与「缺 `w` 时不发明默认宽度」同一条纪律。

**决策 5：`parseThemeStyleEntries` 的 `solidOwner` 参数是死代码，顺手删掉**

调用点传的是 `(node) => node`，而函数里 `solidOwner ? solidOwner(node) : node` 两支结果相同 —— 真正区分两种列表的是下一行「节点本身是 `solidFill`，还是包含一个」。线条条目现在需要读 `w` 与 `prstDash`，本就要独立的解析函数，这个参数随之失去唯一存在理由。

`parseStrokeWidth` 同样拆成收 `a:ln` 节点的 `parseLineWidth` 加一层取形状的包装，与 `parseDashStyle` 对称，两处解析共用同一条「非负整数才算」的规则。

**决策 6：导出与写回都不改，但要有断言**

主题写回只处理 `clrScheme` 与 `fontScheme`，**从不触碰 `fmtScheme`** —— 所以源里的 `lnStyleLst` 作为未建模内容原样保留。这是本切片「读进模型却不写回」能成立的理由，加断言钉住。

standalone 导出写的是空的 `<a:lnStyleLst/>`（`standalone-xml.ts:133`），因此主题线条样式在无源生成路径上整块丢失 —— **这是既有缺口、颜色也一样丢**，不在本切片范围，但要在已知限制里写明。

## 4. 契约（增量）

`ThemeLineStyle`/`ThemeLineStyleEntry` 新增到 `@ppt4ai/model`；`ThemeFormatScheme.lineStyles` 改为 `ThemeLineStyleEntry[]`（对读 `color` 的消费者是兼容变更）。

`validateDocument` 校验线条条目的 `width`（非负整数）与 `style`（三个词之一）。

`resolveStyleLineStroke(reference, theme)` 新增导出。

场景图对 `strokeWidth`/`strokeStyle` 逐属性回退到主题条目。

## 5. 测试策略

- **导入**：`w` 与 `prstDash` 进线条条目；缺任一项时该字段缺席；非法 `w` 忽略；十一个 dash 词的收敛沿用导入端那一处规则；填充与背景条目不受影响（仍是纯 `Fill`）
- **解析**：`idx="0"` 与越界索引返回 `undefined`；`null` 条目不给宽度
- **场景**：只有 `lnRef` 的形状拿到主题宽度与线型；元素自己的值胜出；元素只声明其一时另一项仍取主题（决策 2 的核心）；带文本的形状同样
- **绘制**：主题来的宽度与线型真的改变 `lineWidth` 与 `setLineDash`（走既有 `paintShapeNode`，本切片不改绘制）
- **往返**：改主题颜色后源 `lnStyleLst` 的 `w` 与 `prstDash` 逐字保留；未编辑逐字节不变
- **回归**：现有 1123 项测试

## 6. 已知限制

- standalone 导出写空 `<a:lnStyleLst/>`，主题线条样式（含颜色）在无源生成路径上整块丢失（决策 6）
- `cap`/`cmpd`/`algn`/`join` 在条目上仍不建模，与元素侧同一缺口
- `a:effectStyleLst` 仍完全不建模
- 渐变线条条目仍记 `null`，指向它的形状既无颜色也无宽度（决策 4）
- 主题线条样式没有编辑入口，只读
- `lnRef` 的 `idx` 越界或指向 `null` 时静默无轮廓，不上报 issue

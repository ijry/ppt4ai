# 下划线词逐字保存设计

> 状态：已实现（2026-09-04，`f32e789`）
> 日期：2026-09-04

## 1. 目标

让 `a:rPr/@u` 的词逐字进入模型。今天只建模 `none`/`single`，因此 `dbl`、`heavy`、`dotted`、`dashed`、`wavy` 等十余个词全部塌成 `single` 并被写回文件 —— 这是同一类损坏的第五处，与自动编号那刀同样**改一个字就会改写**。

## 2. 探针结果（实测）

七种 `@u` 各一个 run，逐列是模型值、`createPptx` 写出的词、把该 run 文字改一个字后源包里的词（`underline-probe.test.ts`，已删除）：

```
sng     model="single"  standalone=sng   after-text-edit=sng
dbl     model="single"  standalone=sng   after-text-edit=sng
heavy   model="single"  standalone=sng   after-text-edit=sng
dotted  model="single"  standalone=sng   after-text-edit=sng
dashed  model="single"  standalone=sng   after-text-edit=sng
wavy    model="single"  standalone=sng   after-text-edit=sng
none    model="none"    standalone=none  after-text-edit=none
```

**六个词塌成一个 `sng`，两条导出路径都写 `sng`**：双下划线、波浪线、点线在编辑一个字之后全部变成普通下划线。

## 3. 关键决策

**决策 1：模型逐字保存这个词**

`TextMarks.underline` 从 `'none' | 'single'` 放宽为词。`none` 仍然是显式值（覆盖继承来的下划线，与今天语义一致），`sng` 不再被改写成模型自己的 `single` —— **模型直接存 OOXML 的词**，导出两侧因此逐字。

**决策 2：绘制按词族分三种，不发明数值**

绘制层今天只在 `underline === 'single'` 时画一条线，于是 `dbl`/`wavy` 之类**一条线都不画**（它们塌成 `single` 才画上）。现在：

| 词族 | 画法 | 依据 |
|---|---|---|
| `none` 与缺席 | 不画 | 既有 |
| `dotted`、`dottedHeavy` | 点线（`dashPattern` 的点） | 复用仓库已在用的长度 |
| `dash*`、`dotDash*`、`dotDotDash*` | 划线（`dashPattern` 的划） | 同上 |
| 其余（`sng`/`dbl`/`heavy`/`wavy`/`words`/…） | 一条实线 | 与今天像素相同 |

**`dbl` 不画两条、`heavy` 不加粗、`wavy` 不画波浪**：第二条线的间距、加粗的倍率、波形的振幅都需要发明数值。只做能用既有长度表达的那两族，其余保持今天的一条实线，代价写进限制 —— 与 `prstDash` 那刀第二条决策同一条纪律。

**决策 3：工具栏的开关按「不是 none」判断**

`toggleTextMark` 与状态读取今天问的是 `underline === 'single'`，于是一段 `dbl` 文字在工具栏里显示为**未加下划线** —— 与 `<select>` 把 `lgDashDot` 报成 Solid 是同一个谎。改为「不是 `none` 也不是缺席就是开」；点开写 OOXML 的 `sng`（工具栏只提供这一种）—— 模型的词汇表就是文件的词汇表，写内部词会序列化出没有阅读器认识的 `u="single"`，点关写 `none`。

**决策 4：校验只查词形**

与前几刀同一条，复用 `isOoxmlToken`。

## 4. 契约（增量）

`@ppt4ai/model`：`TextMarks.underline` 放宽为词；校验改为词形。

`@ppt4ai/pptx-import` 与 `@ppt4ai/pptx-export`：`@u` 逐字进出，`text-source.ts` 的镜像同款。

`@ppt4ai/text`：`toggleTextMark` 与格式状态按「不是 none」判断；`TextMarksPatch` 校验放宽。

`@ppt4ai/editor`：`text-painting` 按决策 2 的三种画法。

## 5. 测试策略

- **导入**：六个词逐字进模型；`none` 仍是显式 `none`；空值仍被忽略
- **模型**：合法词通过校验，`not a token!` 被拒
- **绘制**：`dotted` 走点线、`dashed` 走划线、`dbl`/`heavy`/`wavy` 走实线、`none` 不画
- **工具栏状态**：`dbl` 报「已加下划线」（此前报未加）；点关写 `none`
- **往返**：`dbl` 改文字后仍是 `dbl`（此前变 `sng`）；standalone 写出后能重新导入；未编辑逐字节不变
- **回归**：现有 1560 项

## 6. 已知限制

- `dbl`/`heavy`/`wavy`/`words` 等词画成一条实线（决策 2）；模型与文件逐字保留
- 下划线的颜色仍取 run 自己的颜色（`a:uFill`/`a:uLn` 不建模）
- 工具栏仍只能设 `single`/`none`，无法把下划线设成其他词（模型与命令可以）

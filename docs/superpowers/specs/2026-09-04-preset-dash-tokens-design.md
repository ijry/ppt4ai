# 十一个 prstDash 词设计

> 状态：设计
> 日期：2026-09-04

## 1. 目标

让 `a:prstDash/@val` 的十一个 OOXML 词逐字进入模型，从而**往返可逆**。今天导入端把它们收敛成 `solid`/`dash`/`dot` 三个，无源导出因此把用户文件里的 `lgDashDot` 写成 `dash` —— 这不是渲染近似，是改写用户的文件。

## 2. 探针结果（实测）

十一个词各放一个同色同宽的形状，导入后看模型、再经 `createPptx` 看写出的词（`dash-probe.test.ts`，已删除）：

```
solid          model=undefined standalone=(none)
dot            model=dot    standalone=dot
sysDot         model=dot    standalone=dot
dash           model=dash   standalone=dash
lgDash         model=dash   standalone=dash
dashDot        model=dash   standalone=dash
lgDashDot      model=dash   standalone=dash
lgDashDotDot   model=dash   standalone=dash
sysDash        model=dash   standalone=dash
sysDashDot     model=dash   standalone=dash
sysDashDotDot  model=dash   standalone=dash
```

**八个不同的词塌成一个 `dash` 并被写回文件**，`sysDot` 塌成 `dot`。源包路径的同尺寸只说明未编辑时走 byte-roundtrip、编辑时靠写回里那个「先塌再比」的技巧保住了源字节 —— 模型本身仍然无法表达那八个词，所以任何**无源生成**都会改写它们。

## 3. 关键决策

**决策 1：模型收下全部十一个词，与 `cap`/`join` 同一条**

`StrokeStyle` 从三个值扩到 `ST_PresetLineDashVal` 的十一个。模型的职责是记录文件说了什么；导出端本就逐字写出模型值（`standalone-xml.ts` 与 `table.ts` 都是），所以扩宽联合类型之后**往返自动可逆**，不需要映射表。

**决策 2：绘制按「结构」分四种，长度不发明数值**

canvas 的 `setLineDash` 需要具体长度，而 ECMA-376 的数值表**我手头无法核实**（`learn.microsoft.com` 与 `msdn.microsoft.com` 在本环境都取不到，只查到 Google Slides API 对这些词的语义说明：`lgDashDot` = 交替的长划线与点）。因此：

| 词 | 画法（w = 线宽） | 依据 |
|---|---|---|
| `solid` | `[]` | 既有 |
| `dot`、`sysDot` | `[w, 2w]` | 既有 |
| `dash`、`lgDash`、`sysDash` | `[4w, 3w]` | 既有 |
| `dashDot`、`lgDashDot`、`sysDashDot` | `[4w, 3w, w, 3w]` | 既有两段的拼接 |
| `lgDashDotDot`、`sysDashDotDot` | `[4w, 3w, w, 3w, w, 3w]` | 同上 |

只用仓库里**已经在用**的两个长度（划线 4w/3w、点 1w/2w）拼出划-点交替的结构，**不引入任何新数值**。`lg`（更长的划线）与 `sys`（系统细版）的长度差异因此不体现 —— 那需要那张查不到的表，与 `a:miter/@lim` 那刀同一条：只做能确定的部分，代价写进限制。

收益是真实的：`dashDot` 家族此前与普通虚线**画得一模一样**，现在能看出点。

**决策 3：写回删掉「先塌再比」**

`writeback.ts` 的 `collapsedDashStyle` 存在的唯一理由是模型表达不了那八个词（源 `lgDashDot` 只能当作 `dash`，否则每次无关编辑都会把它重写成 `dash`）。模型能逐字持有之后，这个补丁**变成障碍**：它会让「把 `dash` 改成 `lgDash`」比较为相等而不写出。改成逐字比较。

**决策 4：工具栏仍只提供三个选项，但显示已有的那个**

`<select>` 的 `:value` 若不匹配任何 `<option>`，浏览器落到第一项 —— 那会把一条 `lgDashDot` 轮廓**报成 Solid**。因此选项列表 = 三个可选项 + （当前值不在其中时）当前值本身，标签直接用 OOXML 的词。**不为另外八个词加 locale 文案**：它们是「文件里的既有值」而不是「可以挑的样式」，用原词是最不撒谎的标签。挑了三个之一就替换掉它，附加项随之消失。

## 4. 契约（增量）

`@ppt4ai/model`：`StrokeStyle` 扩为十一个词，`strokeStyles` 集合与校验文案随之更新。

`@ppt4ai/pptx-import`：`parseDashStyle` 认得的词逐字返回，其余（含非法值）仍为 `solid`。

`@ppt4ai/editor`：`dashPattern` 按决策 2 的四种结构映射；`strokeStyleOptions(current)` 供工具栏构造选项。

`@ppt4ai/pptx-export`：`lineDashReplacements` 逐字比较，删除 `collapsedDashStyle`。

## 5. 测试策略

- **导入**：十一个词各自逐字进模型；非法值与缺省为 `solid`；表格边框同款
- **模型**：十一个词都通过校验，未知词被拒
- **绘制**：四种结构各一条；未知/缺省为实线；表格边框与形状共用同一份
- **往返**：`lgDashDot` 经 standalone 写出后能重新导入为 `lgDashDot`（此前变 `dash`）；源包里改成 `lgDash` 时写出新词；未编辑逐字节不变；只改宽度时源词逐字保留
- **工具栏**：`lgDashDot` 时选项含该词且被选中（不再误报 Solid），三个可选项仍在
- **回归**：现有 1469 项

## 6. 已知限制

- `lg` 与 `sys` 变体的长度差异不建模（决策 2），画法与各自的基础词相同；模型与文件仍逐字保留
- `a:custDash`（自定义划线序列）仍完全不建模
- 主题 `lnStyleLst` 条目里的 `prstDash` 走同一个 `StrokeStyle`，因此自动受益；但条目的 `cap`/`join` 仍不建模
- 工具栏仍只能设三种，无法把轮廓设成另外八个词中的任何一个

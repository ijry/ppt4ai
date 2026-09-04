# 自动编号词逐字保存设计

> 状态：已实现（2026-09-04，`c389e0a`）
> 日期：2026-09-04

## 1. 目标

让 `a:buAutoNum/@type` 逐字进入模型，并让排版按词本身画出编号。这是 dash、`prstGeom` 之后**同一类损坏的第三处，也是最严重的一处** —— 前两处只在无源导出时改写文件，这一处**改一个字就会改写**。

## 2. 探针结果（实测）

七种编号各一段，逐列是模型值、`createPptx` 写出的词、把段落文字改一个字后源包里的词（`bullet-probe.test.ts`，已删除）：

```
arabicPeriod      model={"type":"autoNum","scheme":"arabic"}  standalone=arabicPeriod  after-text-edit=arabicPeriod
arabicParenR      model={"type":"autoNum","scheme":"arabic"}  standalone=arabicPeriod  after-text-edit=arabicPeriod
arabicPlain       model={"type":"autoNum","scheme":"arabic"}  standalone=arabicPeriod  after-text-edit=arabicPeriod
alphaLcParenBoth  model={"type":"autoNum","scheme":"arabic"}  standalone=arabicPeriod  after-text-edit=arabicPeriod
romanUcPeriod     model={"type":"autoNum","scheme":"arabic"}  standalone=arabicPeriod  after-text-edit=arabicPeriod
romanLcParenR     model={"type":"autoNum","scheme":"arabic"}  standalone=arabicPeriod  after-text-edit=arabicPeriod
ea1ChsPeriod      model={"type":"autoNum","scheme":"arabic"}  standalone=arabicPeriod  after-text-edit=arabicPeriod
```

**七种全部塌成 `arabic`，两条导出路径都写 `arabicPeriod`**：罗马数字列表 `I.` 变成 `1.`、`(a)` 变成 `1.`、中文编号变成 `1.`，而触发条件只是编辑该段落的文字。

探针还暴露一个**真错**：`alphaLcParenBoth` 也塌成了 `arabic`，因为导入端的白名单写的是 `alphaLcParenRight` / `alphaUcParenRight` —— **OOXML 里没有这两个词**（真词是 `alphaLcParenR` / `alphaUcParenR`），所以字母编号在真实文件里从未被识别过。

## 3. 关键决策

**决策 1：模型逐字保存这个词**

`TextBulletScheme` 从三值联合放宽为「`@type` 的词」。与 `prstDash`、`prstGeom` 两刀同一条：模型记录文件说了什么，格式化是排版层的方言。白名单里那个不存在的词随之消失 —— 不再需要白名单。

**决策 2：标记文本从词名本身推出，不查表**

`ST_TextAutonumberScheme` 的词名自带格式说明，因此拉丁族的十六种组合可以直接解析出来：

| 词的构成 | 画法 |
|---|---|
| 家族 `arabic` | `1`、`2`、`3` |
| 家族 `alphaLc` / `alphaUc` | `a`…`z`、`aa` / `A`…`Z`、`AA`（复用既有 `alphaNumber`） |
| 家族 `romanLc` / `romanUc` | `i`/`I`、`ii`/`II`（标准换算，不发明数值） |
| 后缀 `Period` | `1.` |
| 后缀 `ParenR` | `1)` |
| 后缀 `ParenBoth` | `(1)` |
| 后缀 `Plain` | `1` |

**顺带修掉一个既有缺陷**：今天 arabic 标记画成 `1 `（没有点），而 `arabicPeriod` 明确说有点 —— 三个模型词里根本没有「有没有点」这个信息，所以以前画不出来。

**不认识的词按 `arabicPeriod` 画**（`ea1ChsPeriod`、`hindiNumPeriod`、`circleNumDbPlain` 等）：与今天像素相同，且 `arabicPeriod` 是 OOXML 的默认 type。**不发明中文/印地/希伯来编号的字形** —— 那需要各自的字符表，与预设几何那刀同一条纪律。

**决策 3：导出两侧逐字**

`text-xml.ts` 写模型词（转义），`text-source.ts` 的镜像读源词，两边逐字比较。这样「改一个字」不再顺手改写编号，而「真的改了编号」仍会写出。

**决策 4：校验只查词形**

`/^[A-Za-z][A-Za-z0-9]*$/`，与预设几何同一条：`@type` 在 schema 里是枚举，模型的职责是保存。

## 4. 契约（增量）

`@ppt4ai/model`：`TextBulletScheme` 放宽为词；校验改为词形。

`@ppt4ai/pptx-import`：`a:buAutoNum/@type` 逐字；缺省为 `arabicPeriod`（OOXML 默认）。

`@ppt4ai/text`：`markerText` 按决策 2 解析词并格式化；新增罗马数字换算。

`@ppt4ai/pptx-export`：`text-xml.ts` 与 `text-source.ts` 逐字。

## 5. 测试策略

- **导入**：七种词逐字进模型；无 `@type` 为 `arabicPeriod`；非法词形忽略该 bullet
- **模型**：合法词通过校验，`not a token!` 被拒
- **排版**：十六种拉丁组合的标记文本（含 `I.`、`(a)`、`iv)`）；不认识的词按 `1.`；`startAt` 与逐级计数不变
- **往返**：`romanUcPeriod` 改文字后仍是 `romanUcPeriod`（此前变 `arabicPeriod`）；standalone 写出后能重新导入为原词；未编辑逐字节不变
- **回归**：现有 1536 项，其中断言 `1 ` 标记文本的用例按决策 2 有意翻转

## 6. 已知限制

- 非拉丁族的词（`ea1*`、`hindi*`、`hebrew*`、`thai*`、`circleNum*`、`arabic*Minus`、`arabicDb*`）按 `1.` 画；模型与文件仍逐字保留
- `a:buChar`（字符项目符号）不受本刀影响
- 编号的字号/颜色仍取段落首个 run 的 marks（既有行为）
- 仍无「改编号样式」的命令与控件

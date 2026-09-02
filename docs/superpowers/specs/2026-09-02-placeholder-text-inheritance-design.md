# 占位符文本格式继承设计

> 状态：待实现（2026-09-02）
> 日期：2026-09-02

## 1. 目标

让 layout / master 上占位符的**文本格式**（run marks、段落属性、body 属性）继承到幻灯片元素。

## 2. 探针结果（实测）

构造一个 layout，其 `title` 占位符带完整格式：`<a:bodyPr anchor="ctr"/>`、`<a:pPr algn="ctr"/>`、`<a:rPr sz="4400" b="1"><a:latin typeface="Georgia"/>`。幻灯片上的同名占位符只有纯文字。

```
LAYOUT DEFAULTS: {"title":{"bounds":{…},"preset":"rect","text":"Layout title"}}
SLIDE ELEMENT:   {"id":"el_1","kind":"text","bounds":{…},"text":"Slide title",
                  "body":{"paragraphs":[{"runs":[{"text":"Slide title"}]}]},"placeholder":"title"}
```

`ElementDefaults` 有 `body?: TextBody` 字段，**但 `parseDefaults` 从不填它** —— 只填了 `bounds`/`rotation`/`preset`/`fill`/`stroke`/`text`。因此 layout 上的 44pt 粗体 Georgia 居中，一项都没进模型。幻灯片元素拿到的是裸文字。

## 3. 与前几个切片的关系

这是**上一批文本格式切片的最后一块**，且是它们暴露出来的：

- 导入切片给 `parseTextBody` 加了 marks / 段落属性 / body 属性 —— 但 `parseDefaults` 走的是 `parseText`（纯文字），不是 `parseTextBody`。
- 写回切片让 `ElementDefaults.body` 在 `master-layout-writeback.ts:373` 有了完整的写回路径（`textReplacements` 优先用 `defaults.body`，回退到 `defaults.text`）。**写回端早就准备好了，只有解析端没填。**
- 模型的 `resolveInheritedElement` 用 `Object.assign` 按 master → layout → element 顺序覆盖，`body` 作为一个整体字段参与，无需改动。

**注意范围**：本切片做的是 **`a:txBody` 级的占位符继承**，不是设计文档里一直延期的 **`a:defRPr` 段落级默认**。两者不同：

| | 载体 | 本切片 |
|---|---|---|
| 占位符继承 | layout/master 的 `p:sp` 有完整 `p:txBody` | ✅ 做 |
| `a:defRPr` | `a:pPr` 内的默认 run 属性，或 `a:lstStyle`/master `p:txStyles` 的分级默认 | ❌ 仍延期 |

前者是"同名占位符整体继承"，后者是"段落级属性的分级回退链"。前者能独立完成并立刻消除一类真实丢失，后者需要 `defRPr → lstStyle → placeholder → master txStyles` 四级解析。

## 4. 关键决策

**决策 1：`parseDefaults` 改用 `parseTextBody`，`text` 字段保留**

```ts
const body = parseTextBody(shape)
if (body) defaults.body = body
const text = parseText(shape)
if (text.present && text.value) defaults.text = text.value
```

两者并存而非二选一。理由：`ElementDefaults.text` 是既有公开字段，`master-layout-writeback.ts:374` 的 `hasText` 分支与 `:378` 的 `current === defaults.text` 比较都在用它；删掉会改变写回的判断逻辑，属独立切片。**并存的代价是同一份内容存两遍**，但 `body` 优先（`:373` 的 `hasBody` 先判），语义无歧义。

**决策 2：不改 `resolveInheritedElement`**

`Object.assign({}, ...defaults, element)` 已经让 `body` 按 master → layout → 元素自身的顺序覆盖。**`body` 作为整体字段覆盖，不做段落级合并** —— 元素一旦有自己的 `body`（导入的幻灯片占位符总有），就完全接管。

这与 PowerPoint 的真实语义**不完全一致**（真实语义下 `a:defRPr` 是逐属性回退的），但那正是决策 3 划出去的部分。本切片的语义是"元素没有 body 时才用继承的"，明确写入已知限制。

**决策 3：`a:defRPr` 继续延期，理由记录清楚**

这条已在两份设计文档里延期，此处补上具体原因：正确实现要解析 `a:pPr/a:defRPr`（段落级）、`a:lstStyle/a:lvl1pPr…a:lvl9pPr`（形状级分级）、master 的 `p:txStyles/p:titleStyle|p:bodyStyle|p:otherStyle`（母版级分级），再按 level 逐属性回退。模型层需要新增"分级默认"结构，`resolveInheritedElement` 要从整体覆盖改为逐属性合并。

## 5. 契约（增量）

无公开签名变化。`parseDefaults` 内部多填一个已有字段。

`ElementDefaults.body` 从"声明了但永不出现"变为"有格式的占位符会带上"。**这对下游是加法**：`resolveInheritedElement` 已支持，`master-layout-writeback.ts` 已支持，`scenegraph.ts:396` 通过 `resolveInheritedElement` 自动获益。

## 6. 测试策略

- **import**：layout 占位符的 marks / 段落属性 / body 属性进入 `defaults.body`；master 同理；无 `txBody` 的占位符不产生 `body`
- **继承**：元素无自身 body 时拿到 layout 的；元素有 body 时自己的胜出；layout 与 master 都有时 layout 胜出
- **渲染**：scene graph 的文字 layout 反映继承来的对齐（验证解析后的效果而非模型字段）
- **往返**：layout 的 `defaults.body` 经 master/layout 写回后重新导入保持一致
- **`text` 与 `body` 并存**：两者都出现，写回仍走 `body` 分支

## 7. 已知限制

- **`a:defRPr` / `a:lstStyle` / `p:txStyles` 分级默认仍未做**（决策 3）
- `body` 按整体覆盖而非逐属性合并（决策 2），与 PowerPoint 的逐属性回退不同
- `ElementDefaults` 同时存 `text` 与 `body`，内容重复（决策 1）
- 主题字体方案仍是硬编码 Aptos

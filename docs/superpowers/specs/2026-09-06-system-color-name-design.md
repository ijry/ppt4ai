# 系统色的名字进模型

> 状态：设计中
> 日期：2026-09-06

## 1. 目标

`a:sysClr/@val`（系统色的名字，`window`/`windowText`/…）不进模型，导出时被硬编码成 `windowText`。这一刀把这个词建模，让它在两条导出路径上都写回原样。

## 2. 探针结果（实测 2026-09-06）

探针已删除。同一个 `createPptx`，同一个 `lt1`：

```
模型里没有主题     -> <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>      ✔
模型里带着 lt1     -> <a:lt1><a:sysClr val="windowText" lastClr="FFFFFF"/></a:lt1>  ✗
```

**模型带了信息，输出反而更差**。`standalone-xml.ts:181` 的 `defaultThemeColors` 手写着 `lt1: val="window"`、`dk1: val="windowText"`——这个项目知道两者的区别；而模型一旦真的带上那个色位（也就是导入过任何真实 .pptx 之后），`serializeColorXml` 只会写 `windowText`，因为 `Color` 没有地方放那个词。

后果不是「不好看」：阅读器解析 `a:sysClr` 时按 `val` 去查系统颜色，`lastClr` 只是取不到时的缓存值。`window` 与 `windowText` 在正常浅色系统上是白与黑。**每个默认 Office 主题的 `dk1`/`lt1` 都是 `a:sysClr`**，所以任何真实文稿走无源导出后，浅色背景色位会指向系统的深色。

顺带一条：上一刀刚给主题写回加的「`a:sysClr/@val` 原样不动」在源包路径上挡住了同一个损坏（`56de2cf`），但那是「不碰未建模的东西」，无源路径没有源可以不碰，只能建模。

## 3. 一个根因

`Color` 只有 `type`/`v`/`transforms` 三个字段，`v` 装的是 `lastClr` 的十六进制。系统色名从导入端 `parseColor` 起就被丢掉，之后每一层都没有它可写。这是**模型缺字段**，与前几刀「有字段但某一侧读不出」是不同的病：那些能靠补镜像修，这个只能补模型。

## 4. 关键决策

**决策 1：加兄弟字段 `Color.systemName`，不动 `v`**

`v` 继续装十六进制。理由是绘制那一侧（`model/index.ts:1035` 的 `parseRgb(color.v)`）与所有消费者都按「`v` 是颜色值」在读；把 `v` 改成装名字要动整条链路，风险与收益完全不成比例。`systemName` 只在 `type === 'system'` 时有意义，其余类型上出现时被序列化器忽略（不报错——模型层不去 police 这种搭配，与它对枚举词的既有态度一致）。

**决策 2：值按 OOXML token 校验，不校验它是那 30 个词之一**

`ST_SystemColorVal` 是个枚举，但模型的既有立场写在 `isOoxmlToken` 头上：「保留这个词，而不是去管这个枚举」。因此 `validateColor` 只要求 `isOoxmlToken`。

**决策 3：镜像与比较两侧一起加**

`color-source.ts` 的 `sourceColor` 读出这个词，`colorsEqual` 比较它。两侧必须同一刀加：只加模型侧，改名字这件事会被判成「没变」而吞掉；只加比较不加镜像，则每一次导出都会把每个 `a:sysClr` 色位判成变了、无谓重写。这条是 `writeback-mirror-agreement.test.ts` 存在的理由，新增一条断言。

**决策 4：两个导出端的私有校验必须把这个字段带过去**

`theme-writeback.ts:100` 与 `master-layout-writeback.ts:175` 都把模型颜色重建成 `{type, v, transforms}` 再交给序列化器——**新字段会在这两处被静默剥掉**。这正是本条线索反复撞见的「一侧知道」，这次在同一个包里。

**决策 5：主题写回优先写模型的名字，模型没有才不碰源**

上一刀让 `val` 原样不动，因为模型没有它。现在有了：模型带名字就写名字，模型没带（命令构造出的 `{type:'system', v}`）就保持上一刀的行为——不动源里的 `val`，源里根本没有时才补 `windowText`。两条都留着测试。

**决策 6：无源路径的后备仍是 `windowText`**

`serializeColorXml` 拿到没有名字的系统色时写 `windowText`，与今天一致。没有名字的系统色本身是没有意义的输入，这里不发明一个更好的猜测。`defaultThemeColors` 那张手写表可以就此删掉一半吗——不能，它是「模型对这个色位一无所知」时的后备，与本刀无关，留着。

## 5. 契约（增量）

- `@ppt4ai/model`：`Color` 新增可选 `systemName`；`validateColor` 要求它是 OOXML token（存在时）。
- `@ppt4ai/pptx-import`：`parseColor` 读 `a:sysClr/@val` 进 `systemName`。
- `@ppt4ai/pptx-export`：`serializeColorXml` 写 `systemName ?? 'windowText'`；`color-source.ts` 读它；`colorsEqual` 比它；主题与占位符两处私有校验带它过去；主题写回在模型带名字时打补丁写入。
- 对外行为：导入再导出（两条路径）不再把 `val="window"` 写成 `val="windowText"`。

## 6. 验证

- `packages/model/src/system-color.test.ts`（4 条）：`validateDocument` 接受名字、接受这个 build 没听过的词（枚举不由模型管）、拒绝空串／带空格／非字符串；`resolveColor` 仍按 `v` 的十六进制上色
- `packages/pptx-import/src/importer.test.ts` 既有一条主题导入的 `dk1` 预期补上 `systemName: 'windowText'`
- `writeback-mirror-agreement.test.ts`：系统色一条「两边读法一致」
- `packages/pptx-export/src/system-color.test.ts`（8 条）：
  - 无源导出带名字的 `lt1` → `val="window"`，`lastClr` 仍是十六进制
  - 无源导出不带名字 → 仍写 `windowText`（既有行为不回退）
  - 主题写回改名字 → `val` 变、`lastClr` 不动
  - 主题写回模型没名字 → 源里单引号的 `val` 逐字不动（上一刀的保护不回退）
  - 名字与值都相同 → 逐字节等于源
  - 只有名字不同 → 那一格被改写
  - 占位符写回（会把颜色整个重建的那条路）→ 名字写出
  - 幻灯片形状的 `a:sysClr` 填充在无关文本编辑后逐字节不变（源里用单引号写）

区分力（两次实测）：删掉 `colorsEqual` 里比较 `systemName` 的那一行 → 2 条标红（改名字的两条）；删掉镜像里读 `@val` 的那一行 → 2 条标红（镜像一致性那条，与形状填充那条）。

**设计里对第二个破坏的预估是错的**：原本写「未编辑逐字节相同那条会标红」，实测**不会**——主题那条走的是打补丁，镜像少读一个字段只会让它多判一次「变了」，而每一格的值本来相同，于是一个字节也不写。真正能抓住它的是幻灯片形状那条：那条路上「变了」会导致颜色子元素被整块重写，源里的单引号因此变成双引号，字节可见地不同。这是同一个教训的第四次出现，测试是照它补上的。

## 7. 已知限制

- **绘制不使用系统色名**：画布无法查询操作系统颜色，`v` 里的十六进制仍是唯一的绘制依据。这个字段只为持久化存在。
- **`systemName` 出现在非 `system` 类型的颜色上会被忽略**（决策 1），不报错。
- **transform 子元素上未建模的属性**仍只在 transform 列表不变时保留（上一刀的限制）。
- **`fmtScheme` 里的颜色写回仍不存在**，因此那里的系统色也谈不上被改写。

## 8. 实现记录（2026-09-06）

按设计执行，三处值得记：

**决策 5 让上一刀的行为变成了后备而不是被推翻**：`colorValueAttributes` 现在给系统色返回两格——`lastClr` 取模型的值，`val` 取 `systemName ?? 源里的 val ?? 'windowText'`。因此「模型带名字就写名字」与「模型没名字就不碰源」两条同时成立，上一刀那条测试一字未改。

**只有两个地方会静默剥掉新字段，两个都在导出包里**：`theme-writeback.ts` 与 `master-layout-writeback.ts` 的私有 `validateColor` 都是「重建一个 `{type, v, transforms}`」。设计第 4 节点名了它们，实现时确实是这两处——占位符那条测试（`carries the name through the placeholder writeback, which rebuilds the colour`）就是钉这个的。

**区分力预估错了一半，已在第 6 节改正**：删掉镜像里读 `@val` 的那一行，「未编辑逐字节相同」那条**不会**红。打补丁的写回把「多判一次变了」吸收成了「一格都不写」。能抓住它的是幻灯片形状那条路——那里「变了」会整块重写颜色子元素，源里的单引号变成双引号，字节可见地不同。**这是同一个教训的第四次出现**：字节相同要有区分力，必须让「重写」与「不写」在字节上真的不同。

**门禁上踩了一次自己的坑**：`pnpm typecheck` 我用 `grep -c error` 读结果，返回 `1` 被当成了「一行都没有」。`grep -c` 给的是匹配行数，1 就是有错。改成看退出码之后，抓到 `system-color.test.ts` 里一个 `SlideMaster` 上不存在的 `layoutIds` 字段——vitest 不做类型检查，所以测试全绿而 build 会红。

门禁：2109 项测试、全量 typecheck（退出码 0）、全量 build、包边界检查、7 个 e2e 全绿。

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

- `packages/pptx-import/src/theme-import.test.ts`（或既有主题导入测试）：`<a:sysClr val="window" lastClr="FFFFFF"/>` → `{type:'system', v:'FFFFFF', systemName:'window'}`
- `packages/model/src/…`：`validateDocument` 接受合法 token、拒绝空串与带空格的值
- `writeback-mirror-agreement.test.ts`：系统色一条「两边读法一致」
- `packages/pptx-export/src/system-color.test.ts`：
  - 无源导出（`createPptx`）带 `systemName` 的 `lt1` → `val="window"`，且 `lastClr` 仍是十六进制
  - 无源导出不带 `systemName` → 仍写 `windowText`（既有行为不回退）
  - 主题写回：模型改了 `systemName` → `val` 被改成新词、`lastClr` 不动
  - 主题写回：模型没有 `systemName` → 源里的 `val` 逐字不动（上一刀的保护不回退）
  - 占位符写回：`a:solidFill` 里的系统色带名字 → 名字写出
  - 未编辑的系统色 → 逐字节等于源（源里 `val` 用单引号写，确保这条有区分力）

区分力：把 `colorsEqual` 里比较 `systemName` 的那一行删掉 → 「改名字」那条标红；把镜像里读 `val` 的那一行删掉 → 「未编辑逐字节相同」那条标红。

## 7. 已知限制

- **绘制不使用系统色名**：画布无法查询操作系统颜色，`v` 里的十六进制仍是唯一的绘制依据。这个字段只为持久化存在。
- **`systemName` 出现在非 `system` 类型的颜色上会被忽略**（决策 1），不报错。
- **transform 子元素上未建模的属性**仍只在 transform 列表不变时保留（上一刀的限制）。
- **`fmtScheme` 里的颜色写回仍不存在**，因此那里的系统色也谈不上被改写。

## 8. 实现记录

待填。

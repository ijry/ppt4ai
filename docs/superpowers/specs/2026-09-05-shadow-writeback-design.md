# 阴影的源包写回

> 状态：已实现
> 日期：2026-09-05

## 1. 目标

让**修改一个来自源包的形状的外阴影**能写回文件。

## 2. 探针结果（实测）

探针已删除。源包的形状写 `<a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000"><a:srgbClr val="000000"/></a:outerShdw></a:effectLst>`：

| 步骤 | 结果 |
|---|---|
| 导入 | `shadow = {color:{srgb 000000}, blurRadius:50800, distance:38100, direction:2700000}`——**读得出** |
| 把 `shadow` 改成红色 12700 后导出 | `<a:outerShdw blurRad="50800" dist="38100" dir="2700000"><a:srgbClr val="000000"/>`——**原值不动，编辑静默丢失** |

`shadow` 在整个源包写回层里一次都没出现（只在 `standalone-xml.ts` 里），因此写回从不比较它。与尖角限制、可调值那两处同一类缺口，而那两处的搁置理由（「没有 UI 能产生这种编辑」）已经被推翻过一次：**程序直接驱动模型正是本项目的用途**。

## 3. 这是怎么找到的

不是猜的。上一刀用「模型字段名逐个 grep 导入端与导出端」的办法找到了段落 `a:defRPr`；本刀把同一个审计**收窄到写回比较层**（`writeback.ts`/`text-source.ts`/`color-source.ts`/`table.ts`/`theme-writeback.ts`/`master-layout-writeback.ts`/`image-*-writeback.ts`），问「导入端读得出、而这一层从不提及」的字段有哪些。135 个字段名里剩下 19 个，逐个看下来只有两个是真缺口：`shadow` 与 `customGeometry`。

其余 17 个都是审计的假阳性——表格整块重建、主题与 master/layout 各有自己的写回模块、`originalFilename` 是给宿主看的资产元数据而非 OOXML 内容。

## 4. 关键决策

**决策 1：只替换 `a:outerShdw` 节点，绝不动整个 `a:effectLst`**

`a:effectLst` 可能同时装着模型表达不了的效果（`a:glow`、`a:reflection`、`a:softEdge`）。删掉或重写整个列表会连它们一起毁掉——这正是「比较看不见就整块重写」那类损坏，本会话已经修过两次。

因此：模型有阴影而源有 `a:outerShdw` → 替换那个节点；模型没有而源有 → 只删那个节点，`a:effectLst` 留着（可能还有别的效果，空列表本身也是合法的）；源包没有 `a:effectLst` 而模型有阴影 → 按 `CT_ShapeProperties` 序列在 `a:ln` 之后插入一个只含该阴影的列表。

**决策 2：比较落在值上，不在序列化结果上**

源包的 `<a:outerShdw>` 可能带 `sx`/`sy`/`kx`/`algn` 等模型不表达的属性，也可能属性顺序不同。逐字比较会把这些都判成「变了」。因此新增 `sourceOuterShadow(effectList)`（镜像导入端的 `parseOuterShadow`，与 `sourceFill` 镜像 `parseDirectFill` 同一分工），比较四个建模值。

**代价说清楚**：一旦确实需要替换，那些未建模的属性会随节点一起消失。这不是本刀新增的损失（模型从来读不到它们），但从「不碰就不丢」变成了「改阴影就丢」。写进已知限制。

**决策 3：`customGeometry` 的写回不在本刀**

同一个审计也指出它。但替换一条路径与替换一个属性不是同一量级的事：`a:custGeom` 里有 `a:avLst`/`a:gdLst`/`a:rect`/`a:pathLst`，而模型只表达字面坐标的 `a:pathLst`，所以「按模型重写」会丢掉前三者。要做对得先决定那三者怎么保留，那是独立一刀。写进未实现。

## 5. 契约（增量）

`@ppt4ai/pptx-export`：新增 `sourceOuterShadow`（放在 `color-source.ts`，与 `sourceFill` 同处）与 `shadowReplacements`；`strokeReplacements` 之后调用它（`a:effectLst` 在 `a:ln` 之后）。`serializeShadowXml` 从 `standalone-xml.ts` 导出，供写回复用同一份输出。

模型、导入、渲染、绘制**不改**。

## 6. 验证

`packages/pptx-export/src/shadow-writeback.test.ts`：
- 未编辑时字节相同
- 改阴影 → 新值写出，`a:effectLst` 仍在
- 删阴影 → 只有 `a:outerShdw` 消失，`a:effectLst` 保留
- 源包无 `a:effectLst` 时加阴影 → 在 `a:ln` 之后插入
- **`a:effectLst` 里的 `a:glow` 在阴影被替换后仍然存在**（决策 1 的那个陷阱）
- 只改 bounds 时阴影节点逐字不变

## 7. 已知限制

**替换阴影会丢掉它未建模的属性**：`sx`/`sy`/`kx`/`ky`/`algn`/`rotWithShape` 不在模型里，因此一旦该节点被重写就不再出现。不碰阴影则完全不受影响。

**`customGeometry` 仍写不回去**：理由见决策 3。

## 8. 实现记录（2026-09-05）

实现提交 `待填`。按设计执行，一处值得记：

**既有测试里有一条正是钉住这个缺口的**。`outer-shadow.test.ts` 的 `leaves the effect list alone even when the model shadow is dropped` 删掉 `shape.shadow` 后断言整个 `a:effectLst` 逐字不变——它记录的是「删阴影什么也不会发生」。本刀让删除真的生效，那条立刻标红。

它保护的**真正性质**仍然成立且更值得钉：`a:glow` 与列表本身都留着，只有 `a:outerShdw` 消失。因此不是删掉那条测试，而是拆成三条：只删阴影节点、只替换阴影节点、以及**替换时确实丢掉 `sx`/`algn`/`rotWithShape`**——最后这条把已知限制变成可见行为，而那个 fixture 本来就带着这三个未建模属性，等于替我准备好了素材。

三条新测试的区分力已验证：把两处 `shadowReplacements` 调用删掉，七条里三条标红。

# 元素删除写回设计（通用，非图表专属）

> 状态：设计待批准（2026-10-09）
> 分支：`feat/element-deletion-writeback`(从合并后的 main 拉)。

## 1. 目标

让 writeback 支持**删除元素后导出**:模型比源少了元素时,把对应的源形状节点**从 slide XML 里摘掉**,而不是抛错。引擎侧的 `deleteElements` 早已能删(移模型+子树),缺的只有导出这一环——所以"编辑器里删得掉、存盘就炸"。这是**所有 kind 通用**的缺口,比图表后续更普适。

## 2. 现状核实（已验,file:line)

- `replaceSlideTables`(`writeback.ts:1542`):`if (slide.elementIds.length < sourceElements.length) throw 'element count mismatch'`,**无条件**(不分 reuse)。
- 主循环(`:1957`)另有一处非 reuse 的同样计数检查。
- 新增只支持**尾部追加图片**(`:1629`/`:2002`:`element.kind !== 'image'` 即抛 "only supports trailing image additions")。
- 结论:**删任何元素→导出必抛 `element count mismatch`**(reuse/非 reuse 都抛)。早前记忆里"reuse 下源节点静默保留"的猜测**是错的**,已更正。用一次性 probe(2 形状删 1 导出)也复现了抛错路径。

## 3. 做法

模型比源少 = 有源形状在模型里没有对应 `el_N` → 删它的节点。源扫描的每个 `ScannedElement` 带 `expectedId`(el_N)和节点的 `start`/`end` 偏移,所以删节点 = 一条 `{ start, end, value: '' }` 的 Replacement。

- **reuse 模式(常见编辑路径,本期主体)**:按 id 配对(`scannedById`)。遍历 `scanned.elements`,凡 `expectedId` 不在 `slide.elementIds` 集合里的 → 该源节点删除。把 `:1542`/`:1957` 的"少于就抛"换成"少的那些删掉"。
- **保留项不受扰**:仍在模型里的元素照常走现有 patch(bounds/text/fill/table/chart…);只对"模型没有的"源节点加删除 Replacement。没有删除时不产生任何 Replacement → **字节一致**(护栏)。

<!-- APPEND-BELOW -->

## 4. 要处理的几件事

- **id 稳定**:`deleteElements` 删中间元素后,其余元素 id 不变(el_1、el_3),按 id 配对成立(模型 el_3 → `scannedById.get('el_3')` = 源第 3 个)。源扫描的 el_N 仍是源顺序。
- **组(grpSp)**:删一个组要摘整棵 `grpSp` 子树。扫描把组记为 `grp_N`(advance 位置、无可写内容)+ 其子元素各自 el_N。删组时:若组在模型里没了,删 `grpSp` 节点(其 start/end 覆盖整棵子树),并跳过其子元素(别重复删/错位)。本期可先只做**叶子节点删除**(sp/pic/graphicFrame),组删除列 block 2。
- **孤儿关系/部件**:删图片/图表节点后,slide rels 里那条关系、以及 media/chart 部件会变孤儿。已有 `findOrphanedParts` 会清无引用的**部件**;slide rels 里的**关系条目**残留一般无害(PowerPoint 容忍未用关系)。本期:删节点即可,孤儿关系条目清理列 follow-up(或顺带清,看成本)。
- **非 reuse(克隆页)**:按位置配对,删除要在位置映射里对齐,更麻烦;本期聚焦 reuse(导入后编辑的常见路径),非 reuse 删除列 block 3。

## 5. 分块构建顺序（每块 TDD、门禁看退出码）

1. **reuse 叶子删除**:改 `replaceSlideTables`(+主循环计数检查)—— 模型缺的源 sp/pic/graphicFrame 节点加删除 Replacement,不再抛;护栏:没删时字节一致。**先编辑再断言**的往返测(删 el_2→导出→重新 import 只剩 el_1,且 el_1 内容对)。
2. **组删除**:删 `grpSp` 子树 + 跳过其子。
3. **孤儿关系条目清理** + **非 reuse 删除**。

## 6. 风险与待验证

- **主循环 vs replaceSlideTables 两处计数检查**:两处都要放开,且逻辑一致(镜像),否则一处放行一处抛。
- **删除后 el_N 配对**:务必按 id(reuse)判断"源节点在不在模型",别按长度;长度相等但身份不同(删一个又加一个)也要正确——本期加法仍只支持尾部图片,先不混。
- **组子元素的双重处理**:删组别把其子元素又当独立删除项处理(位置/子树重叠)。block 2 专门管。
- **孤儿 media 部件**:确认 `findOrphanedParts` 会在元素删除后把只被它引用的 media 清掉(待测);否则导出里留无用 media(无害但臃肿)。

## 7. 验收契约

- reuse 页:删一个叶子元素 → 导出不抛、该形状节点从 slide XML 消失、其余元素原样;重新 import 元素数−1、保留的内容正确(往返测)。
- 没删元素:现有写回全部照旧、字节一致(护栏)。
- 组删除(block 2):整棵子树消失。
- 每块有测;全仓 `vitest` + 各包 `typecheck` 退出码 0;相关包 `build` 绿。

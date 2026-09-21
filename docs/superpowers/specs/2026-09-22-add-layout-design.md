# 新建（复制）版式设计

> 状态：已实现（2026-09-22，模型 + standalone + UI + 源写回新部件物化）
> 日期：2026-09-22

## 1. 目标

路线图 §9 母版编辑器:新增版式。第一刀取"复制现有版式"——从一个现有版式派生一个同母版的新版式,可切换幻灯片到它。

## 2. 关键决策

**决策 1：engine `addLayout(sourceLayoutId, layoutId?)` 复制现有版式**

克隆源版式(含背景/默认值/颜色映射)、换新 id、**删掉 `source.partPath`**(它是新版式,不对应任何源部件)、挂到 `document.layouts`。`validateDocument` 兜底,可撤销。id 缺省用 `idFactory`/`lyt_added_N` 去重。

**决策 2：standalone 生成天然支持,源写回按"安全降级"处理**

standalone `createPptx` 的 `planInheritance` 从模型枚举全部版式,因此新版式自动成为一个 `slideLayoutN.xml` 部件、母版 `sldLayoutIdLst` 增项、关系齐全——已由测试验证往返。**源写回**里 `rewriteSourceMastersAndLayouts` 只处理有 `source.partPath` 的部件,新版式没有源部件故被跳过(不写新部件);切到新版式的幻灯片在源写回路径下保留其源版式关系(安全降级,不破坏导出),直到"新部件物化"单独落地。

## 3. 测试策略（TDD）

- **engine**（`set-slide-layout.test.ts`,+4）:复制并切换、撤销;搬运背景且丢 `source`;缺源抛错;自动去重 id。
- **standalone**（`added-layout-standalone.test.ts`,1）:每个模型版式写一个部件、reimport 携带该版式背景。
- **playground**（wiring,+2）:复制加一个同母版版式并可切换;未知源报 `layout-missing`。
- **回归**：全量 2486 项。

## 4. 后续:源写回新部件物化(已补,2026-09-22)

materializeAddedLayouts(在 xportPptx 里 slidePlans 之前运行)把无 source.partPath 的模型版式物化为源包里的真实部件:分配 slideLayoutN.xml、序列化(serializeLayoutXml)、写它的 .rels(指向源母版的相对路径)、往母版 .rels 加 slideLayout 关系、往母版 p:sldLayoutIdLst 插 p:sldLayoutId(insertSldLayoutId,含自闭合/缺列表两种情形)、加 content-types override,并返回一张 layoutId → LayoutRelationship 表喂给 slidePlans/layoutRelationshipsById,使切到新版式的页的 .rels 自动重指向新部件。测试 dded-layout-writeback.test.ts 断言:双版式部件、母版列两项、content-types 有新 override、版式 rels 指母版、页 rels 指新版式,且 reimport 携带新版式背景;未加版式时逐字节相同。

## 5. 已知限制

- 只复制现有版式;空白新版式、删除版式是后续项。
- 全新合成母版(源包里也没有的母版)下的新版式仍只在 standalone 路径完整(源写回需要母版本身也物化,是另一刀)。

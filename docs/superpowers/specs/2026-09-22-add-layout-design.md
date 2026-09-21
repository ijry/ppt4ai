# 新建（复制）版式设计

> 状态：已实现（2026-09-22，模型 + standalone + UI；源写回新部件物化延期）
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

## 4. 已知限制

- **源写回不物化新版式部件**(新 `slideLayoutN.xml` + 关系 + content-types + `sldLayoutIdLst` 增项)——这是与"多母版拆部件"同量级的独立切片;当前新版式只在 standalone 生成路径完整。
- 只复制现有版式;空白新版式、删除版式是后续项。

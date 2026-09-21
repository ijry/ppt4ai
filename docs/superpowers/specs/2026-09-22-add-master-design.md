# 新建（复制）母版设计

> 状态：已实现（2026-09-22，模型 + standalone + UI；源写回新母版部件物化延期）
> 日期：2026-09-22

## 1. 目标

路线图 §9 母版编辑器的最后一大项:新增母版。第一刀取"复制现有母版"——从一个现有母版派生一个新母版,并同时复制它的一个版式(母版必须至少拥有一个版式,才自洽)。

## 2. 关键决策

**决策 1：engine `addMaster(sourceMasterId, masterId?)` 连带复制一个版式**

克隆源母版(背景/默认值/`themeId`/颜色映射/文本样式)、换新 id、删 `source`;同时找到该母版下的一个源版式克隆成新版式(换 id、`masterId` 指向新母版、删 `source`)。两者一并 commit(单条历史,一次撤销全撤)。源母版无任何版式则抛错(无法造出自洽母版)。

**决策 2：standalone 天然支持**

`planInheritance` 从模型枚举全部母版/版式/主题,新母版自动成一个 `slideMasterN.xml` + 它的版式 + 主题部件集,关系与 `sldMasterIdLst`/`sldLayoutIdLst` 齐全。`added-master-standalone.test.ts` 验证:两个母版部件、各自版式、reimport 携带新母版版式的背景。

**决策 3：源写回按安全降级**

探针核实:新母版/版式无 `source.partPath`,`materializeAddedLayouts` 只处理"母版有源部件"的新版式,故合成母版整套在源写回路径**不物化**;引用新母版的新页作为 blank plan 回落到首个源版式关系(指向现有母版),输出仍合法、不崩。真正完整的是 standalone 生成路径。源写回物化整套新母版(新 master + theme 部件 + presentation `sldMasterIdLst`)是更重的独立后续刀。

## 3. 测试策略（TDD）

- **engine**（`add-master.test.ts`,4 项）:复制母版+版式并撤销;搬运背景/主题、丢 `source`;缺源母版抛错;母版无版式抛错。
- **standalone**（`added-master-standalone.test.ts`,1 项）:双母版各写部件+版式、reimport 携带背景。
- **playground**（wiring,+2）:复制母版加一套;未知源报 `master-missing`。
- **回归**:全量 2504 项。

## 4. 已知限制

- 源写回不物化全新母版部件集(见决策 3);当前新母版只在 standalone 生成路径完整往返。
- 只复制现有母版;空白新母版是后续项。删除母版亦未做(需保证至少留一个母版 + 无页引用)。

# 切换幻灯片版式设计

> 状态：已实现（2026-09-22）
> 日期：2026-09-22

## 1. 目标

路线图 §9 母版编辑器的一环:让一张幻灯片能改用同一母版下的另一个版式("换版式生效")。engine 加 `setSlideLayout` 命令,源写回把该页的版式关系重指向新版式。

## 2. 关键决策

**决策 1：engine `setSlideLayout` 只允许同母版的版式**

幻灯片沿"页→版式→母版"链继承占位符与颜色映射,换到别的母版下的版式会解析到错误主题,因此校验 `layout.masterId === 当前 master`,否则抛错。`masterId` 不动(版式自带)。相同版式为 no-op(不入历史)。

**决策 2：源写回复用已有的 `rewriteSlideLayoutRelationship`**

该页 `.rels` 里的 `slideLayout` 关系已有重指向逻辑(clone/新增页用);现在 reuse 页的 `layoutId` 变化时也走它,把 Target 改成新版式部件。写回按 `layoutRelationshipsById` 把模型 `layoutId` 映射回源版式部件路径。未改动则逐字节相同。

## 3. 测试策略（TDD）

- **engine**（`set-slide-layout.test.ts`,4 项）：同母版切换+撤销;拒异母版;缺失抛错;相同版式 no-op。
- **写回**（`slide-layout-switch-writeback.test.ts`,3 项）：双版式导入各自 id;改 slide1 的 layoutId→其 `.rels` 指向 slideLayout2;未改逐字节相同。
- **playground**（wiring,+2）：切换成功/相同 no-op;未知版式报 `layout-missing`。
- **回归**：全量 2478 项。

## 4. 已知限制

- 只切换到**同母版**的现有版式;新建版式、跨母版重挂是后续切片。
- playground 种子只有一个版式,wiring 测试验证守卫与接线而非多版式切换视觉。

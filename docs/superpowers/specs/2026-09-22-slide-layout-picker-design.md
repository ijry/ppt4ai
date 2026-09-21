# 幻灯片版式选择器接入面板设计

> 状态：已实现（2026-09-22）
> 日期：2026-09-22

## 1. 目标

把上一刀的 `setSlideLayout`(engine + 写回)接到 playground:加一个版式下拉,让用户在同母版的版式间切换当前页。属路线图 §9"换版式生效"的编辑入口。

## 2. 关键决策

**决策 1：种子文档加第二个版式**

`asset-host.ts` 的 `createDocument` 原本只有一个版式,版式选择器无从演示;加 `lay_playground_title`(同母版、带 accent3 背景),让选择器与切换在 demo 里可见可测。

**决策 2：picker 只列同母版版式,选择器 change → `setSlideLayout`**

`App.vue` 的 `slideLayoutChoices` 计算当前页母版下的版式清单与当前 `layoutId`;下拉仅在有 >1 个版式时显示(单版式无意义)。change 时调 `assetHost.setSlideLayout(layoutId)`,engine 的同母版校验兜底。en/zh 加 `panel.slideLayout.label`。

## 3. 测试策略（TDD）

- **wiring**（`slide-background-wiring.test.ts`,+1）：两个种子版式间切换,`layoutId` 从 `lay_playground` 变到 `lay_playground_title`、状态成功。
- **回归**：全量 2479 项。

## 4. 已知限制

- 只在同母版现有版式间切换(与 engine 命令一致);新建版式是后续切片。
- 选择器 label 用版式 id(种子无版式名);真实文档可用 `p:cSld/@name`。

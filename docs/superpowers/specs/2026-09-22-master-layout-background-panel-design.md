# 母版/版式背景编辑接入面板设计

> 状态：已实现（2026-09-22）
> 日期：2026-09-22

## 1. 目标

把已就绪的 `setMasterBackground`/`setLayoutBackground`(engine 命令 + 源写回都已完成)接到编辑器背景面板,让用户能编辑母版/版式的背景,而不只是当前幻灯片。属路线图 §9 母版编辑器的一部分。

## 2. 关键决策

**决策 1：目标选择放在 playground 宿主,面板保持目标无关**

背景面板组件不认"幻灯片/版式/母版"——它只发 `set-color`/`set-gradient`/`set-pattern`/`set-picture`/`clear`。宿主(App.vue)加一个 `backgroundTarget` 选择器(本页/版式/母版),`applyBackground` 按目标路由到 `setSlideBackground`/`setLayoutBackground`/`setMasterBackground`。这样面板不背负页面结构知识,目标选择这个产品决策留在宿主。

**决策 2：非幻灯片目标用"该部件自己声明的背景"驱动面板模型**

幻灯片目标沿用已解析场景色(所见即所画);版式/母版目标编辑的是该部件**自己的** `p:bg`,所以用 `ownBackgroundOf(target)` 取其声明的 fill 驱动 `slideBackgroundModel`(不掺入继承的场景色)。

**决策 3：asset-host/presentation-host 加两个方法,按当前页解析目标 id**

`setMasterBackground` 从当前页 → 版式 → 母版链解析 masterId;`setLayoutBackground` 取当前页的 layoutId;缺失则 `*-missing` 失败。engine 校验 + 写回本就支持,故端到端往返。

## 3. 测试策略（TDD）

- **wiring**（`slide-background-wiring.test.ts`,+3）：设母版背景→成功且模型落库;设/清版式背景;母版背景经继承画到幻灯片场景色。
- **回归**：全量 2464 项。

## 4. 已知限制

- 目标选择器在 playground 宿主;组件库不内置(不同宿主的页面结构不同)。
- 母版/版式的**图片**背景写回已支持(前几刀),此处面板选图片同样可用。

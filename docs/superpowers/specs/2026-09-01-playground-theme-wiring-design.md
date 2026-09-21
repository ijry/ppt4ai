# playground 主题面板接入设计

**日期**：2026-09-01 · **阶段**：阶段 6 · **状态**：已批准，待实现

## 1. 目标

把已完成的 `ThemePanel` 接进 playground 外壳，让「改主题色 → 画布变化」在跑起来的应用里可验证。当前 `ThemePanel`、`theme-editor-controller` 与 engine `setThemeColor` 均有单测覆盖契约，但从未在真实应用中运行过。

## 2. 现状的两个障碍

**障碍 1：种子文档没有主题，也没有 scheme 色引用。** `apps/playground/src/asset-host.ts:88` 的种子文档只有 `slides`/`elements`/`assets`，没有 `themes`/`masters`/`layouts`；元素颜色全是硬编码 `srgb`（如 `DDEBFF`）。面板接上去会一直禁用，即使给它主题，画布也不会变化 —— 没有元素引用 `scheme` 色。

**障碍 2：playground 每页一个 engine，与主题的文档级语义冲突。** `presentation-host.ts:123` 的 `pageDocument` 用 `structuredClone` 给每页复制整份文档，`themes` 也被复制。改当前页主题不会同步到其他页，而 PPTX 语义里主题由 master 共享。

## 3. 范围

本切片刻意**不**做跨页主题同步 —— 见 §4 决策 1 的论证：在当前 `undo()` 双栈优先级下，跨页广播无法做到语义正确。

**做**：

- 种子文档新增 master + layout + theme，并把部分元素填充改为 `scheme` 色引用，使改色可见
- `App.vue` 挂载 `ThemePanel`，用 `theme-editor-controller` 直接驱动当前页 engine
- 中英文 i18n 补 playground 侧标签

**不做**（明确延期）：

- 跨页主题同步 —— 需要先给 engine 增加「文档级命令不记入单页历史」的能力，独立切片
- 重构 playground 的分页数据模型（每页一份 document 副本）为共享文档
- 字体/格式方案编辑、主题增删切换、master/layout 绑定编辑
- PowerPoint/LibreOffice 人工阅读器验证（环境所限）

**已知限制**：主题编辑只作用于当前页。PPTX 真实语义里主题由 master 共享，应影响所有引用该 master 的页。playground 暂时展示的是页级作用域，差距在此显式记录。

## 4. 关键决策

**决策 1：主题编辑只作用于当前页，走单页 engine 栈**

跨页广播在当前架构下无法做到语义正确。`presentation-host.ts:251` 的 `undo()` **优先消费当前页 engine 栈**，只有该栈空了才动 presentation 栈。三条广播路径均有硬伤：

- 走 engine 命令广播 → 每页 engine 栈各压一条记录。用户按 undo 时先撤销 engine 栈里的主题记录，presentation 栈里那条仍在，再按一次会重复撤销，状态错乱。
- 绕过 engine 直接改 document → `PlaygroundAssetHost` 接口不暴露 `engine`（`asset-host.ts:121` 那个只是传给 image controller 的参数）。
- 重建每页 engine → 丢掉该页已有的 undo 栈。

干净的解法需要 engine 支持「文档级命令不记入单页历史」，那是改 engine 历史语义、会波及既有全部测试的独立切片。

因此本切片让主题编辑完全走当前页 engine：undo/redo 行为正确且可预测，只是作用域小于 PPTX 真实语义。这个差距记为已知限制，不用一个半对的广播去掩盖它。

**决策 2：种子文档加 master/layout/theme 并改用 scheme 色**

新增 `mst_playground`（`themeId: 'thm_playground'`）、`lay_playground`（`masterId: 'mst_playground'`）、`thm_playground`（`colors: {}`，全部继承 Office 默认）。`slides.sld_playground` 增加 `layoutId: 'lay_playground'`。

`shape_demo` 的填充从 `{ type: 'srgb', v: 'DDEBFF' }` 改为 `{ type: 'scheme', v: 'accent1' }`，表格首行两格填充改为 `{ type: 'scheme', v: 'accent2' }`。这样改 accent1/accent2 立即在画布与缩略图上可见。

`pageDocument` 已 `structuredClone` 整份文档，`themes`/`masters`/`layouts` 会自动带到每页，无需改动它。每页因此各持一份主题副本 —— 这正是决策 1 所述限制的来源。

**决策 3：面板始终可见，无主题时禁用**

`App.vue` 侧栏常驻主题面板。`active` 绑定 `controller.activeThemeId() !== undefined`，与既有工具栏 `active` 语义一致。

## 5. 组件契约

`presentation-host.ts` 与 `asset-host.ts` 的公开接口**不变** —— 本切片不新增 host 方法。种子文档变更发生在 `asset-host.ts` 的 `createDocument()` 内部。

**`App.vue` 接线**

`App.vue` 需要拿到当前页 engine 才能构造 controller，但 `PlaygroundAssetHost` 不暴露 engine。因此 controller 在 `App.vue` 里无法直接创建。

改为：`App.vue` 不使用 `createThemeEditorController`，而是从 `activeSlideSnapshot.engineState.document` 自行计算槽位展示模型（复用 editor 导出的 `THEME_SLOT_GROUPS`、`hexFromColor`、`themeSlotGroup`），写入则通过 `presentation-host` 新增的一个薄方法转发到当前页 engine 的 `setThemeColor` 命令。

这是对 §5 原设计的修正：既然不做广播，就不需要 controller 的间接层；但仍需要一个 host 方法，因为 engine 不对外暴露。新增：

```ts
export interface PlaygroundPresentationHost {
  // ...既有成员
  setThemeColor(slot: ThemeColorSlot, color: Color | null): PlaygroundPresentationSnapshot
}
```

该方法只作用于 `activeHost()`，走既有 `forward()` 通道，因此自动纳入当前页 engine 历史，与既有编辑操作行为一致。`asset-host.ts` 相应新增 `setThemeColor(themeId, slot, color)`，内部 `engine.dispatch({ type: 'setThemeColor', ... })`。

## 6. 错误处理

- 无可达主题时 host 返回 `status: { kind: 'error', message: 'theme-missing' }`，不抛错
- engine 校验失败时错误在 host 内被捕获并转为 `status.kind === 'error'`，与既有上传失败处理一致
- 面板对非法输入不发事件（`colorFromHex` 返回 `undefined` 即静默），已由 editor 侧测试覆盖

## 7. 测试策略

TDD，每个行为先见红。

- `apps/playground/src/asset-host.test.ts`：种子文档含 master/layout/theme；`setThemeColor` 写入与重置；无主题时错误状态；scheme 色元素能解析出主题色
- `apps/playground/src/presentation-host.test.ts`：`setThemeColor` 转发到当前页并进入该页 engine 历史；undo/redo 还原
- `apps/playground/src/App.test.ts`：面板渲染 12 槽位、启用态、改色后 scene 颜色变化

**门禁**：全仓 `pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm check:boundaries`、Element Plus 扫描、`git diff --check`。

## 8. 验收标准

1. playground 侧栏显示 12 槽位主题面板，种子文档下为启用态
2. 改 accent1 后当前页画布与该页缩略图的对应元素颜色变化
3. undo 回退主题改动，redo 恢复（走当前页 engine 栈）
4. 重置按钮写入 `null`，画布回到 Office 默认色
5. 全部门禁通过

**不在验收范围**：跨页主题一致性 —— 见 §3 已知限制。

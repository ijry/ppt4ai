# 缩略图渲染失败事件设计

> 状态：已实现（2026-09-04，`f29b99d`）—— `npx vitest run` 退出码 1 → 0，`Errors` 92 → 0
> 日期：2026-09-04

## 1. 目标

让 `ThumbnailCanvas` 在渲染器整体失败时**报告**而不是**抛未捕获的 Promise**。今天 `npx vitest run` 的退出码是 1，92 条 unhandled rejection 全部来自这里；同一条代码路径在缺少 `bitmaprenderer` 支持的真实浏览器里会同样刷屏。

## 2. 探针结果（实测）

`npx vitest run`：159 个测试文件、1466 项**全部通过**，但

```
Errors  92 errors
exit=1
92 × ThumbnailRendererError: bitmaprenderer context is unavailable / { code: 'worker-failed' }
92 × This error originated in "apps/playground/src/shape-paint-wiring.test.ts"
```

`git stash` 前后逐条相同，因此与刚完成的图片填充那刀无关，是既有缺陷。

根因在 `ThumbnailCanvas.vue:45-47`：

```ts
} catch (error) {
  if (!(error instanceof DOMException && error.name === 'AbortError')) throw error
}
```

`renderThumbnail()` 由 `onMounted` 与 `watch` 以 `void renderThumbnail()` 调用，**没有任何人能接住这个 rethrow**。取消（`AbortError`）被正确地咽掉了，真正的失败却变成 unhandled rejection：既污染门禁，又让宿主拿不到任何信号。

`ThumbnailRendererError` 只有一个 `code`（`'worker-failed'`，`thumbnail-renderer.ts:36-43`），缺上下文与 worker 崩溃都用它。

## 3. 关键决策

**决策 1：新增 `error` 事件，不再 rethrow**

组件已经有 `render` 事件送出 `ThumbnailRenderResult`（含 per-node `issues`），缺的是**渲染器级**失败的出口。加一个 `error: [error: unknown]`，宿主想处理就处理、不处理就是 no-op —— 这正是 Vue 事件的语义，也不需要每个宿主都写 try/catch。

**否决"静默咽掉"**：那把一个可见的噪声换成一个不可见的空白缩略图，与仓库既有的 issue 上报纪律相反（图片填充那刀刚为同类问题选了"上报 + 降级"）。

**否决"改测试打桩 `bitmaprenderer`"**：那只让门禁变绿，真实浏览器里的行为一字未改。桩可以以后再加，缺陷得先修在组件里。

**决策 2：`AssetLibrary` 把它当作那张图的缩略图失败**

`AssetLibrary.vue` 已有 `failedAssetIds` 与 `assetLibrary.thumbnailFailure` 文案，由 `@render` 的 `issues` 驱动。渲染器整体失败对用户的意义完全相同（这张图没有缩略图），所以走同一条路，不新增文案、不新增 locale key。

**决策 3：playground 不接**

它是 demo 外壳，缩略图失败时留空即可；接进状态栏要新增两份 locale 条目，与本刀要修的缺陷无关。记入限制。

**决策 4：`AbortError` 仍然不算失败**

取消是正常路径（切页、改尺寸都会取消上一次），既不 emit `error` 也不 emit `render`。这条行为逐字保留。

## 4. 契约（增量）

`ThumbnailCanvas` 新增 `error: [error: unknown]`；`render` 与其余 props 不变。

`AssetLibrary` 监听 `@error`，把该资产加入 `failedAssetIds`。

## 5. 测试策略

- **组件**：渲染器 reject 时 emit `error`、不产生 unhandled rejection；`AbortError` 既不 emit `error` 也不 emit `render`；成功路径逐字不变（既有断言）
- **资产库**：`@error` 让那张图显示既有的缩略图失败文案
- **门禁**：`npx vitest run` 退出码从 1 变 0，`Errors` 从 92 条变 0 条 —— 这是本刀真正的验收标准
- **回归**：现有 1466 项

## 6. 已知限制

- `ThumbnailRendererError.code` 仍只有 `'worker-failed'` 一个值，"缺 `bitmaprenderer` 上下文"与"worker 崩了"因此无法区分；细分要连带定义宿主该如何区别对待，是独立一刀
- playground 的缩略图失败仍不可见（决策 3）
- jsdom/happy-dom 仍然没有 `bitmaprenderer` 上下文，因此 playground 测试里的缩略图**始终**走失败路径；本刀只让它安静且可报告，不让它真的画出来

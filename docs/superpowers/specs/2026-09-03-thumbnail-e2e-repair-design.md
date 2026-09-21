# 恢复缩略图 e2e 护栏设计

> 状态：已实现（2026-09-03，`38371c1`）
> 日期：2026-09-03

## 1. 目标

修掉唯一一条浏览器侧 e2e 的失败，并让 `npx playwright test` 只跑 e2e。上一刀实测这两条都是既有问题；没有绿的 e2e，浏览器侧的回归（包括刚修的坐标空间）没有任何护栏。

## 2. 探针结果（实测）

```
Error: expect(locator).toHaveJSProperty(expected) failed
Locator: locator('[data-testid="thumbnail-canvas"]')
Expected: 320
Error: element(s) not found
```

`page.goto` 成功、webServer 起得来 —— **失败不是环境问题，是选择器在页面里根本不存在**。

`grep` 页面实际渲染的 testid：

```
apps/playground/src/App.vue:343  data-testid="slide-thumbnail-list"
apps/playground/src/App.vue:347  :data-testid="`slide-thumbnail-${slideId}`"
```

而 spec 找的是 `thumbnail-canvas` / `thumbnail-result` / `thumbnail-next` —— 三个都不存在。

## 3. 根因（从 git 历史读出来的）

- `711c205`（2026-08-23，`test: verify thumbnail worker in chromium`）写下这条 spec，当时页面是**单个缩略图加一个「下一张」按钮**。
- `3b7a2e0`（2026-08-30，`feat: add playground slide navigation UI`）把那套 UI 换成**按页的缩略图列表**，`App.test.ts` 同步更新了（新增 44 行断言），**e2e spec 没动**。

所以这条 e2e 从 8-30 起就是死的。`npx playwright test` 还会先在 vitest 文件上崩掉（见决策 2），这大概是它一直没被注意到的原因。

## 4. 关键决策

**决策 1：spec 对着页面实际渲染的东西重写，不去把旧 UI 加回来**

新 spec 断言的是当前 UI 的可观察行为：缩略图列表有**两个**按钮（`createPageEntries` 只播两页 —— 实测浏览器里是 2，`App.test.ts` 里的 3 是点过「新增页」之后的场景，两者不矛盾）、每个里面的 canvas 是 240×135 且**像素非空**、点击第二个缩略图把 `aria-current` 移过去。

**「像素非空」这条必须留着** —— 它是原 spec 里唯一真正验证「worker 在真实 chromium 里画出了东西」的断言，也是唯一能在浏览器里挡住绘制回归的断言。其余（元素存在、尺寸）单测已经覆盖，`App.test.ts` 里就有。

**决策 2：`testMatch` 限定到 `e2e` 目录，不改 `testDir`**

playwright 默认 `testMatch` 是 `**/*.@(spec|test).?(c|m)[jt]s?(x)`，配上 `testDir: './apps'` 就会把 `apps/playground/src/*.test.ts` 这些 vitest 文件收进来并在 `describe` 上崩掉。加一条

```ts
testMatch: '**/e2e/**/*.spec.ts'
```

**否决把 `testDir` 改成某个具体 e2e 目录**：现在有两个 app 各带自己的 `e2e/`（ime-lab 与 playground），`testDir` 只能给一个。限定 `testMatch` 同时覆盖两者，且以后新增 app 的 e2e 自动纳入。

**决策 3：只修 spec 与配置，不碰被测代码**

失败原因完全在 spec 侧。缩略图 worker 本身没有问题（`App.test.ts` 的单测一直是绿的），所以本刀**一行产品代码都不改** —— 否则就是拿「改被测对象」去让测试变绿。

## 5. 契约（增量）

无。只有 `playwright.config.ts` 增加 `testMatch`，与 spec 文件重写。

## 6. 测试策略

本刀的产出**就是**测试，所以判据是：

- `npx playwright test` 不再在 vitest 文件上报错，只收 e2e spec
- 缩略图 spec 在真实 chromium 里绿
- ime-lab 的 spec 仍被收进来（`testMatch` 没把它排除掉）
- `pnpm test`（vitest）1242 项不受影响

## 7. 已知限制

- 仍然没有针对 `SlideCanvas` 的 e2e，所以上一刀修的坐标空间在浏览器里仍未验证 —— `apps/` 没有挂载 `SlideCanvas`，要先有挂载点，属独立切片
- 缩略图 spec 只断言「像素非空」，不做像素比对，因此颜色错、位置偏这类回归它挡不住
- ime-lab 的 5 条 spec 此前从未真正跑到（收集阶段就崩了），本刀之后实测全绿 —— 但它们的断言是否仍匹配当前 ime-lab UI，本刀只验证了「通过」，没有逐条复核其覆盖是否还有意义

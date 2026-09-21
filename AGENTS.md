# AGENTS.md — ppt4ai 开发约定

## 分支与提交
- **只在 `main` 上开发**：不再新建功能分支、不再开 PR。直接在 `main` 提交并 `git push origin main`。
- 每完成一个可验证的切片就提交(feat/fix + 配套 docs),并推送。
- 提交信息用祈使句摘要,正文说明动机与关键决策。

## 质量门禁(每个切片提交前必须全绿)
- `npx vitest run`(全量测试)
- `pnpm run typecheck`(递归类型检查)
- `pnpm run check:boundaries`(12 包边界)
- `pnpm run build`(生产构建)

## 工作方式
- TDD:先写失败测试(红),再实现(绿),再验证。
- 跨包改动后先 `pnpm --filter <pkg> build`,因为下游测试从 dist 引入。
- 每个成体系切片在 `docs/superpowers/specs/` 留一份设计文档,并在 `进度.md` 记录。
- 进度与缺口以 `进度.md` 的散文为准;发现过时记录要就地纠正。

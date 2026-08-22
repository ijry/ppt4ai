# Stage 0 Verification

## Decision

**PASS — Stage 0 is complete.**

The IME risk gate is GO, the twelve-package workspace skeleton is enforced, the Vue 3 + UnoCSS shell typechecks and builds, and the full verification sequence passes from a fresh dependency install.

## Environment

| Item | Value |
|---|---|
| Date | 2026-08-22 |
| OS | Microsoft Windows 11 IoT Enterprise LTSC, build 26100 |
| Node.js | v22.22.2 |
| pnpm | 10.33.2 |
| TypeScript | 6.0.3 |
| Vite | 8.2.2 |
| Vitest | 4.1.11 |
| Playwright | 1.62.1 |
| Chromium | Playwright Chromium 151.0.7922.34 |
| Vue | 3.5.41 |
| vue-i18n | 11.2.8 |
| UnoCSS | 66.8.1 |

## Verification Matrix

| Command | Result | Evidence |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | Fresh sibling verification copy installed all 15 workspace projects |
| `pnpm check:boundaries` | PASS | `Package boundaries OK (12 packages)` |
| `pnpm test` | PASS | 7 test files, 29 tests passed |
| `pnpm test:e2e` | PASS | 5 Chromium tests passed |
| `pnpm typecheck` | PASS | All 14 projects with typecheck scripts passed, including `vue-tsc` |
| `pnpm build` | PASS | All package and app builds passed; playground bundle generated |

The same sequence also passed in the current worktree before the clean-install check. The clean-install check used a sibling copy of the current uncommitted snapshot because this session does not create commits; the existing worktree was never reset or modified by that check.

## IME Gate

Manual Windows verification was confirmed by the user as **GO** for Chrome and Edge. The checklist records passing candidate-window following, exactly-once Chinese commit, cancellation, Unicode backspace, visual wrapping, 80%/100%/125% browser zoom, and available 150% display-scale scenarios.

See [IME spike result](2026-08-22-ime-spike-result.md) and [manual checklist](../../apps/ime-lab/e2e/manual-ime-checklist.md).

## Stage 0 Deliverables

- Tasks 1-6: IME contract, hidden `contenteditable` bridge, Canvas caret/composition rendering, soft wrapping, CDP tests, and Windows manual GO gate.
- Task 7: twelve `@ppt4ai/*` packages, root project references, Vitest workspace coverage, and dependency-boundary checker.
- Task 8: Vue 3 editor shell, semantic `zh-CN`/`en-US` locale parity, UnoCSS-only styling setup, and runnable playground.
- Task 9: reproducible README commands and this verification record.

## Next Target

Phase 1: implement the `model`, `geometry`, and `render` contracts, then establish JSON-to-SceneGraph and Canvas rendering snapshot tests.
